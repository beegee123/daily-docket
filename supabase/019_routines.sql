-- Daily Docket, step 22: routines
-- A routine is a saved checklist you run again and again: Guest
-- turnover, Monday work setup, Sunday service prep. Its steps live in
-- the row itself, in order, as a list of text. (Step 23 will start one:
-- a single task whose notes are the steps as a checklist.)
--
-- Routines follow their area: everyone who can see the area can see,
-- add, edit and delete its routines, so a co-host in Rentals shares the
-- Guest turnover routine.
--
-- Run after 018. Safe to re-run.

create table if not exists docket.routines (
  id          uuid primary key default gen_random_uuid(),
  area_id     uuid not null references docket.areas (id) on delete cascade,
  created_by  uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name        text not null check (char_length(trim(name)) between 1 and 80),
  steps       text[] not null default '{}'
              check (cardinality(steps) between 1 and 50),
  times_used  int not null default 0,          -- counted by step 23
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists routines_by_area on docket.routines (area_id);

-- No blank steps, and none longer than a task title can be
create or replace function docket.check_routine_steps()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from unnest(new.steps) s where char_length(trim(s)) = 0 or char_length(s) > 200) then
    raise exception 'Each step needs some words (and at most 200 characters).';
  end if;
  return new;
end;
$$;

drop trigger if exists routines_check_steps on docket.routines;
create trigger routines_check_steps
  before insert or update of steps on docket.routines
  for each row execute function docket.check_routine_steps();

drop trigger if exists routines_set_updated_at on docket.routines;
create trigger routines_set_updated_at
  before update on docket.routines
  for each row execute function docket.set_updated_at();

-- Same visibility as the area, like trips and events
alter table docket.routines enable row level security;

drop policy if exists "routines: read"   on docket.routines;
drop policy if exists "routines: add"    on docket.routines;
drop policy if exists "routines: change" on docket.routines;
drop policy if exists "routines: delete" on docket.routines;

create policy "routines: read" on docket.routines
  for select to authenticated
  using (docket.can_see_area(area_id));
create policy "routines: add" on docket.routines
  for insert to authenticated
  with check (created_by = (select auth.uid()) and docket.can_see_area(area_id));
create policy "routines: change" on docket.routines
  for update to authenticated
  using (docket.can_see_area(area_id))
  with check (docket.can_see_area(area_id));
create policy "routines: delete" on docket.routines
  for delete to authenticated
  using (docket.can_see_area(area_id));

grant select, insert, update, delete on docket.routines to authenticated;
grant all on docket.routines to service_role;

-- Live sync: a routine edited on one phone updates on the other
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'docket' and tablename = 'routines'
  ) then
    alter publication supabase_realtime add table docket.routines;
  end if;
end;
$$;
