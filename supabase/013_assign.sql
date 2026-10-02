-- Daily Docket, step 15: assign tasks in shared areas
-- Run after 012. Safe to re-run.

-- ---------------------------------------------------------------
-- save_task now also sets who a task is assigned to (null = anyone).
-- You can only assign to someone in one of the task's areas.
-- ---------------------------------------------------------------
drop function if exists docket.save_task(uuid, text, text, date, date, uuid[]);

create or replace function docket.save_task(
  p_id             uuid,
  p_title          text,
  p_notes          text,
  p_scheduled_date date,
  p_due_date       date,
  p_area_ids       uuid[],
  p_assigned_to    uuid default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Please sign in again.';
  end if;
  if p_title is null or char_length(trim(p_title)) = 0 then
    raise exception 'A task needs a title.';
  end if;
  if p_scheduled_date is null then
    raise exception 'Pick a day for this task.';
  end if;
  if coalesce(cardinality(p_area_ids), 0) = 0 then
    raise exception 'Pick at least one area.';
  end if;

  -- The assignee must be the owner or a joined member of one of the areas
  if p_assigned_to is not null and not exists (
       select 1 from docket.areas a
       where a.id = any (p_area_ids)
         and (a.owner_id = p_assigned_to
              or exists (select 1 from docket.area_members m
                         where m.area_id = a.id and m.user_id = p_assigned_to))
     ) then
    raise exception 'You can only assign a task to someone who shares one of its areas.';
  end if;

  if p_id is null then
    insert into docket.tasks (title, notes, scheduled_date, original_date, due_date, assigned_to)
    values (trim(p_title), nullif(trim(p_notes), ''), p_scheduled_date, p_scheduled_date, p_due_date, p_assigned_to)
    returning id into v_id;
  else
    update docket.tasks
       set title          = trim(p_title),
           notes          = nullif(trim(p_notes), ''),
           scheduled_date = p_scheduled_date,
           original_date  = least(original_date, p_scheduled_date),
           due_date       = p_due_date,
           assigned_to    = p_assigned_to
     where id = p_id
    returning id into v_id;

    if v_id is null then
      raise exception 'That task no longer exists.';
    end if;
  end if;

  delete from docket.task_areas
   where task_id = v_id
     and area_id <> all (p_area_ids);

  insert into docket.task_areas (task_id, area_id)
  select v_id, a from unnest(p_area_ids) as a
  on conflict do nothing;

  return v_id;
end;
$$;

grant execute on function docket.save_task(uuid, text, text, date, date, uuid[], uuid) to authenticated;
revoke execute on function docket.save_task(uuid, text, text, date, date, uuid[], uuid) from anon, public;


-- ---------------------------------------------------------------
-- "My" tasks for Close the day and Shift plan:
-- assigned to me, or unassigned and added by me.
-- (A task you added but assigned to him is his job, not yours.)
-- ---------------------------------------------------------------
create or replace function docket.is_my_job(p_created_by uuid, p_assigned_to uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select case when p_assigned_to is not null then p_assigned_to = auth.uid()
              else p_created_by = auth.uid() end;
$$;
grant execute on function docket.is_my_job(uuid, uuid) to authenticated;

create or replace function docket.close_day(p_items jsonb)
returns table (moved int, dropped int)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_item    jsonb;
  v_count   int;
  v_moved   int := 0;
  v_dropped int := 0;
begin
  if auth.uid() is null then
    raise exception 'Please sign in again.';
  end if;

  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    if v_item->>'action' = 'drop' then
      update docket.tasks
         set dropped_at = now()
       where id = (v_item->>'id')::uuid
         and docket.is_my_job(created_by, assigned_to)
         and status <> 'done'
         and dropped_at is null;
      get diagnostics v_count = row_count;
      v_dropped := v_dropped + v_count;

    elsif v_item->>'action' = 'move' then
      if v_item->>'date' is null then
        raise exception 'A moved task needs a date.';
      end if;
      update docket.tasks
         set scheduled_date = (v_item->>'date')::date,
             original_date  = least(original_date, (v_item->>'date')::date)
       where id = (v_item->>'id')::uuid
         and docket.is_my_job(created_by, assigned_to)
         and status <> 'done'
         and dropped_at is null;
      get diagnostics v_count = row_count;
      v_moved := v_moved + v_count;

    elsif v_item->>'action' = 'restore' then
      update docket.tasks
         set dropped_at     = null,
             scheduled_date = coalesce((v_item->>'date')::date, scheduled_date)
       where id = (v_item->>'id')::uuid
         and docket.is_my_job(created_by, assigned_to)
         and dropped_at is not null;
      get diagnostics v_count = row_count;
      v_moved := v_moved + v_count;

    else
      raise exception 'Unknown action: %', v_item->>'action';
    end if;
  end loop;

  return query select v_moved, v_dropped;
end;
$$;

create or replace function docket.reschedule(p_items jsonb)
returns int
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count int;
begin
  if auth.uid() is null then
    raise exception 'Please sign in again.';
  end if;

  update docket.tasks t
     set scheduled_date = (i->>'scheduled_date')::date,
         original_date  = coalesce((i->>'original_date')::date, t.original_date)
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as i
   where t.id = (i->>'id')::uuid
     and docket.is_my_job(t.created_by, t.assigned_to)
     and (i->>'scheduled_date') is not null
     and t.status <> 'done'
     and t.dropped_at is null;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;


-- ---------------------------------------------------------------
-- Tell someone when a task is assigned to them.
-- After a task is saved with a new assignee (not yourself), ask the
-- send-digest Edge Function to push "Bee assigned you: ...". This uses
-- pg_net and the docket_cron_secret from 010_digest_schedule.sql.
-- If anything here fails, the task still saves; only the nudge is lost.
-- ---------------------------------------------------------------
create or replace function docket.notify_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.assigned_to is not null
     and new.assigned_to is distinct from coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid)
     and (tg_op = 'INSERT' or new.assigned_to is distinct from old.assigned_to)
     and new.status <> 'done'
     and new.dropped_at is null
  then
    begin
      perform net.http_post(
        url     := 'https://cqiwinquzfynelkmeywc.supabase.co/functions/v1/send-digest',
        headers := jsonb_build_object(
          'Content-Type',  'application/json',
          'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'docket_cron_secret')
        ),
        body    := jsonb_build_object('assigned_task', new.id, 'assigned_by', auth.uid()),
        timeout_milliseconds := 10000
      );
    exception when others then
      raise warning 'Assignment notification not sent: %', sqlerrm;
    end;
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_notify_assignment on docket.tasks;
create trigger tasks_notify_assignment
  after insert or update of assigned_to on docket.tasks
  for each row execute function docket.notify_assignment();
