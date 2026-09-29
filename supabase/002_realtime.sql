-- Daily Docket, step 4: live sync
-- Adds the docket tables to Supabase Realtime so a change on one device
-- shows up on the others. Realtime still respects row-level security:
-- you only hear about your own rows.
-- Safe to re-run.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'docket' and tablename = 'tasks'
  ) then
    alter publication supabase_realtime add table docket.tasks;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'docket' and tablename = 'task_areas'
  ) then
    alter publication supabase_realtime add table docket.task_areas;
  end if;
end;
$$;
