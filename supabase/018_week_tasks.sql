-- Daily Docket, step 19: this-week tasks
-- Some work is planned by the week, not the day ("TDX this week:
-- sandbox refresh, AN, devops pipeline"). A this-week task has
-- week_of = the Monday of its week, and no scheduled_date.
--
-- A task is either on a day (scheduled_date) or in a week (week_of),
-- never both. Because of that, everything built for days keeps working
-- untouched: Today, Close the day and the morning digest all look for
-- scheduled_date, so this-week tasks simply don't appear there.
--
-- Roll-over needs no job: an unfinished task from an earlier week just
-- keeps its old week_of, and the app shows it in the current week with
-- "↻ 1 week". original_date stays the first Monday it was planned for.
--
-- Run after 017. Safe to re-run.

alter table docket.tasks add column if not exists week_of date;
alter table docket.tasks alter column scheduled_date drop not null;

-- week_of is always a Monday
alter table docket.tasks drop constraint if exists tasks_week_is_monday;
alter table docket.tasks add constraint tasks_week_is_monday
  check (week_of is null or extract(isodow from week_of) = 1);

-- Exactly one of: a day, or a week
alter table docket.tasks drop constraint if exists tasks_day_or_week;
alter table docket.tasks add constraint tasks_day_or_week
  check ((scheduled_date is null) <> (week_of is null));

create index if not exists tasks_by_week on docket.tasks (week_of) where week_of is not null;

-- Moving a task between a day and a week: whichever one was just set
-- wins and the other is cleared. So "Do today" is a plain
-- "set scheduled_date = today", and older functions that only know about
-- days (restore from History, reopen day, Undo) still work on these tasks.
create or replace function docket.task_day_or_week()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.week_of is not null and new.week_of is distinct from old.week_of then
    new.scheduled_date := null;
  elsif new.scheduled_date is not null and new.scheduled_date is distinct from old.scheduled_date then
    new.week_of := null;
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_day_or_week on docket.tasks;
create trigger tasks_day_or_week
  before update of scheduled_date, week_of on docket.tasks
  for each row execute function docket.task_day_or_week();


-- save_task learns weeks: pass p_week_of (any day in the week) instead of
-- a day. The old 7-argument version is replaced.
drop function if exists docket.save_task(uuid, text, text, date, date, uuid[], uuid);

create or replace function docket.save_task(
  p_id             uuid,
  p_title          text,
  p_notes          text,
  p_scheduled_date date,
  p_due_date       date,
  p_area_ids       uuid[],
  p_assigned_to    uuid default null,
  p_week_of        date default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id   uuid;
  v_week date;
  v_day  date;
  v_first date;  -- the day or Monday this task is planned for
begin
  if auth.uid() is null then
    raise exception 'Please sign in again.';
  end if;
  if p_title is null or char_length(trim(p_title)) = 0 then
    raise exception 'A task needs a title.';
  end if;
  if p_scheduled_date is null and p_week_of is null then
    raise exception 'Pick a day or a week for this task.';
  end if;
  if coalesce(cardinality(p_area_ids), 0) = 0 then
    raise exception 'Pick at least one area.';
  end if;

  -- A week wins over a day if both are sent; always store the Monday
  if p_week_of is not null then
    v_week := p_week_of - (extract(isodow from p_week_of)::int - 1);
    v_day  := null;
  else
    v_week := null;
    v_day  := p_scheduled_date;
  end if;
  v_first := coalesce(v_day, v_week);

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
    insert into docket.tasks (title, notes, scheduled_date, week_of, original_date, due_date, assigned_to)
    values (trim(p_title), nullif(trim(p_notes), ''), v_day, v_week, v_first, p_due_date, p_assigned_to)
    returning id into v_id;
  else
    update docket.tasks
       set title          = trim(p_title),
           notes          = nullif(trim(p_notes), ''),
           scheduled_date = v_day,
           week_of        = v_week,
           -- Moving between day and week is a re-plan; within days it
           -- only ever moves earlier, so carry-over counts stay honest
           original_date  = case
                              when (week_of is null) <> (v_week is null) then v_first
                              else least(original_date, v_first)
                            end,
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

revoke execute on function docket.save_task(uuid, text, text, date, date, uuid[], uuid, date) from public, anon;
grant execute on function docket.save_task(uuid, text, text, date, date, uuid[], uuid, date) to authenticated;


-- reschedule (Shift plan and its Undo) learns weeks too: an item can
-- carry week_of instead of scheduled_date. Still only your own jobs.
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
     set scheduled_date = case when (i->>'week_of') is not null then null
                               else (i->>'scheduled_date')::date end,
         week_of        = (i->>'week_of')::date,
         original_date  = coalesce((i->>'original_date')::date, t.original_date)
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as i
   where t.id = (i->>'id')::uuid
     and docket.is_my_job(t.created_by, t.assigned_to)
     and ((i->>'scheduled_date') is not null or (i->>'week_of') is not null)
     and t.status <> 'done'
     and t.dropped_at is null;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
