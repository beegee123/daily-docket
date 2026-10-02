-- Daily Docket, step 13: manage areas
-- Safe to re-run.

-- Delete an area without leaving any task area-less: first link its tasks
-- (open, done and dropped) to another area, then delete it. One transaction,
-- so either both happen or neither does. Returns how many tasks were moved.
create or replace function docket.delete_area(p_area uuid, p_move_to uuid)
returns int
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_tasks int;
  v_moved int := 0;
begin
  if auth.uid() is null then
    raise exception 'Please sign in again.';
  end if;

  if not exists (select 1 from docket.areas where id = p_area) then
    raise exception 'That area no longer exists.';
  end if;

  if (select count(*) from docket.areas) <= 1 then
    raise exception 'You need at least one area.';
  end if;

  select count(*) into v_tasks from docket.task_areas where area_id = p_area;

  if v_tasks > 0 then
    if p_move_to is null or p_move_to = p_area then
      raise exception 'Choose another area for this area''s tasks first.';
    end if;
    if not exists (select 1 from docket.areas where id = p_move_to) then
      raise exception 'The area to move tasks to no longer exists.';
    end if;

    insert into docket.task_areas (task_id, area_id)
    select task_id, p_move_to from docket.task_areas where area_id = p_area
    on conflict do nothing;
    get diagnostics v_moved = row_count;
  end if;

  delete from docket.areas where id = p_area; -- its links go with it
  return v_moved;
end;
$$;

-- Save a new order: the first id gets sort_order 1, and so on
create or replace function docket.reorder_areas(p_ids uuid[])
returns void
language sql
security invoker
set search_path = ''
as $$
  update docket.areas a
     set sort_order = o.pos
    from unnest(p_ids) with ordinality as o(id, pos)
   where a.id = o.id;
$$;

grant execute on function docket.delete_area(uuid, uuid) to authenticated;
grant execute on function docket.reorder_areas(uuid[]) to authenticated;
revoke execute on function docket.delete_area(uuid, uuid) from anon, public;
revoke execute on function docket.reorder_areas(uuid[]) from anon, public;

-- Live sync: area changes on one device show on the others
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'docket' and tablename = 'areas'
  ) then
    alter publication supabase_realtime add table docket.areas;
  end if;
end;
$$;
