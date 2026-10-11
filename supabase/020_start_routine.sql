-- Daily Docket, step 23: start a routine
-- Starting "Guest turnover" adds ONE task called "Guest turnover" whose
-- notes are the routine's steps as a checklist ("- [ ] Strip beds"), on
-- the day or week you pick. Today then shows "0/6" and the steps are
-- ticked in place; they carry over together if unfinished.
-- The task belongs to the routine's area, so a co-host there can tick
-- steps too. Editing the routine later doesn't change tasks already
-- started from it.
--
-- Run after 019. Safe to re-run.

create or replace function docket.start_routine(
  p_routine uuid,
  p_day     date default null,   -- a day, or...
  p_week    date default null    -- ...any date in a week ("This week")
)
returns uuid
language plpgsql
security invoker               -- your own permissions: you must be able to see the routine
set search_path = ''
as $$
declare
  v_routine docket.routines;
  v_notes   text;
  v_task    uuid;
begin
  if auth.uid() is null then
    raise exception 'Please sign in again.';
  end if;
  if p_day is null and p_week is null then
    raise exception 'Pick a day or a week to start the routine.';
  end if;

  select * into v_routine from docket.routines where id = p_routine;
  if not found then
    raise exception 'That routine no longer exists.';
  end if;

  select string_agg('- [ ] ' || trim(s), E'\n' order by n)
    into v_notes
    from unnest(v_routine.steps) with ordinality as t(s, n);

  -- save_task does the rest: day or week, the area link, the checks
  v_task := docket.save_task(
    null, v_routine.name, v_notes, p_day, null, array[v_routine.area_id], null, p_week
  );

  update docket.routines set times_used = times_used + 1 where id = p_routine;

  return v_task;
end;
$$;

revoke execute on function docket.start_routine(uuid, date, date) from public, anon;
grant execute on function docket.start_routine(uuid, date, date) to authenticated;
