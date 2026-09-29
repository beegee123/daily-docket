-- Daily Docket, step 5: save a task and its areas in one go
-- A function runs as a single transaction: if any part fails (say, an
-- area that isn't yours), the whole save is undone. No half-saved tasks.
-- security invoker = it runs as YOU, so row-level security still applies.
-- Safe to re-run.

create or replace function docket.save_task(
  p_id             uuid,     -- null = new task
  p_title          text,
  p_notes          text,
  p_scheduled_date date,     -- the day it sits on your docket (your local date)
  p_due_date       date,     -- optional
  p_area_ids       uuid[]
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

  if p_id is null then
    -- New task: its first day on a docket is the day it's scheduled for
    insert into docket.tasks (title, notes, scheduled_date, original_date, due_date)
    values (trim(p_title), nullif(trim(p_notes), ''), p_scheduled_date, p_scheduled_date, p_due_date)
    returning id into v_id;
  else
    -- Existing task. original_date only ever moves EARLIER: pushing a task
    -- to Friday keeps its carry count; pulling a Friday task to today
    -- starts the count today.
    update docket.tasks
       set title          = trim(p_title),
           notes          = nullif(trim(p_notes), ''),
           scheduled_date = p_scheduled_date,
           original_date  = least(original_date, p_scheduled_date),
           due_date       = p_due_date
     where id = p_id
    returning id into v_id;

    if v_id is null then
      raise exception 'That task no longer exists.';
    end if;
  end if;

  -- Make the task's areas exactly p_area_ids: remove the rest, add the new
  delete from docket.task_areas
   where task_id = v_id
     and area_id <> all (p_area_ids);

  insert into docket.task_areas (task_id, area_id)
  select v_id, a from unnest(p_area_ids) as a
  on conflict do nothing;

  return v_id;
end;
$$;

grant execute on function docket.save_task(uuid, text, text, date, date, uuid[]) to authenticated;
revoke execute on function docket.save_task(uuid, text, text, date, date, uuid[]) from anon, public;
