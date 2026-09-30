-- Daily Docket: shift a plan (and undo it)
-- Moves a list of open tasks to new days in ONE transaction.
-- p_items: [{"id": "...", "scheduled_date": "2026-10-03", "original_date": "2026-10-03"}, ...]
-- A shift is a re-plan, not falling behind, so the app sends
-- original_date = the new day (no "carried over" badge). Undo sends the
-- old values back. Done or dropped tasks are never touched.
-- Returns how many tasks moved. Safe to re-run.

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
     and (i->>'scheduled_date') is not null
     and t.status <> 'done'
     and t.dropped_at is null;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

grant execute on function docket.reschedule(jsonb) to authenticated;
revoke execute on function docket.reschedule(jsonb) from anon, public;
