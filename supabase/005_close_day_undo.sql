-- Daily Docket, steps 6-7: undo and restore
-- Replaces close_day with a version that also understands "restore":
-- bring a dropped task back onto a given day. Undo after Close the day
-- sends "move" items back to each task's previous day, and "restore"
-- items for anything that was dropped.
-- Safe to re-run.

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
         and status <> 'done'
         and dropped_at is null;
      get diagnostics v_count = row_count;
      v_moved := v_moved + v_count;

    elsif v_item->>'action' = 'restore' then
      -- Un-drop, and put it on the given day (or leave its day as it was)
      update docket.tasks
         set dropped_at     = null,
             scheduled_date = coalesce((v_item->>'date')::date, scheduled_date)
       where id = (v_item->>'id')::uuid
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

grant execute on function docket.close_day(jsonb) to authenticated;
revoke execute on function docket.close_day(jsonb) from anon, public;
