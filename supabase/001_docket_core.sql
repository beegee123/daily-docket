-- Daily Docket, step 1: core tables
-- Runs in the Pantry Supabase project. Everything lives in its own
-- "docket" schema so it never collides with Pantry's tables.
-- Safe to re-run: every statement checks before creating.

create schema if not exists docket;

-- Let the API roles see the schema. Tables are granted further down.
grant usage on schema docket to anon, authenticated, service_role;


-- ---------------------------------------------------------------
-- Helper: keep updated_at current on every change
-- ---------------------------------------------------------------
create or replace function docket.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;


-- ---------------------------------------------------------------
-- Areas: Work, Home, Rentals, Ministry ...
-- Each person owns their own. Sharing arrives in Phase 2.
-- ---------------------------------------------------------------
create table if not exists docket.areas (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid()
              references auth.users (id) on delete cascade,
  name        text not null check (char_length(trim(name)) between 1 and 40),
  color       text not null default '#2B45C9'
              check (color ~ '^#[0-9A-Fa-f]{6}$'),
  sort_order  int  not null default 0,
  created_at  timestamptz not null default now(),
  unique (owner_id, name)
);


-- ---------------------------------------------------------------
-- Tasks: one row per task, ever. Carry-over is a query, not a copy.
--   scheduled_date = the day it sits on your docket (moves when you
--                    reschedule it)
--   original_date  = the day it was first put on a docket (never moves;
--                    days carried = today - original_date)
-- ---------------------------------------------------------------
create table if not exists docket.tasks (
  id              uuid primary key default gen_random_uuid(),
  created_by      uuid not null default auth.uid()
                  references auth.users (id) on delete cascade,
  assigned_to     uuid references auth.users (id) on delete set null,
  title           text not null check (char_length(trim(title)) between 1 and 200),
  notes           text,
  status          text not null default 'todo'
                  check (status in ('todo', 'doing', 'done')),
  scheduled_date  date not null default current_date,
  original_date   date not null default current_date,
  due_date        date,
  remind_at       timestamptz,
  reminded_at     timestamptz,
  completed_at    timestamptz,
  completed_by    uuid references auth.users (id) on delete set null,
  dropped_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- "done" and "has a completed time" must always agree
  constraint tasks_done_has_time
    check ((status = 'done') = (completed_at is not null))
);

drop trigger if exists tasks_set_updated_at on docket.tasks;
create trigger tasks_set_updated_at
  before update on docket.tasks
  for each row execute function docket.set_updated_at();

-- Speeds up the Today query: my open tasks, by date
create index if not exists tasks_open_by_owner_date
  on docket.tasks (created_by, scheduled_date)
  where status <> 'done' and dropped_at is null;


-- ---------------------------------------------------------------
-- Task <-> Area link (many-to-many, like Pantry's item <-> store)
-- ---------------------------------------------------------------
create table if not exists docket.task_areas (
  task_id  uuid not null references docket.tasks (id) on delete cascade,
  area_id  uuid not null references docket.areas (id) on delete cascade,
  primary key (task_id, area_id)
);

create index if not exists task_areas_by_area on docket.task_areas (area_id);


-- ---------------------------------------------------------------
-- Row-level security: each person sees only their own rows.
-- (select auth.uid()) is wrapped in a select so Postgres works it out
-- once per query instead of once per row.
-- ---------------------------------------------------------------
alter table docket.areas      enable row level security;
alter table docket.tasks      enable row level security;
alter table docket.task_areas enable row level security;

-- Areas
drop policy if exists "areas: read own"   on docket.areas;
drop policy if exists "areas: add own"    on docket.areas;
drop policy if exists "areas: change own" on docket.areas;
drop policy if exists "areas: delete own" on docket.areas;

create policy "areas: read own" on docket.areas
  for select to authenticated
  using (owner_id = (select auth.uid()));
create policy "areas: add own" on docket.areas
  for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy "areas: change own" on docket.areas
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
create policy "areas: delete own" on docket.areas
  for delete to authenticated
  using (owner_id = (select auth.uid()));

-- Tasks
drop policy if exists "tasks: read own"   on docket.tasks;
drop policy if exists "tasks: add own"    on docket.tasks;
drop policy if exists "tasks: change own" on docket.tasks;
drop policy if exists "tasks: delete own" on docket.tasks;

create policy "tasks: read own" on docket.tasks
  for select to authenticated
  using (created_by = (select auth.uid()));
create policy "tasks: add own" on docket.tasks
  for insert to authenticated
  with check (created_by = (select auth.uid()));
create policy "tasks: change own" on docket.tasks
  for update to authenticated
  using (created_by = (select auth.uid()))
  with check (created_by = (select auth.uid()));
create policy "tasks: delete own" on docket.tasks
  for delete to authenticated
  using (created_by = (select auth.uid()));

-- Task <-> Area links: you can only link your own task to your own area
drop policy if exists "task_areas: read own"   on docket.task_areas;
drop policy if exists "task_areas: add own"    on docket.task_areas;
drop policy if exists "task_areas: delete own" on docket.task_areas;

create policy "task_areas: read own" on docket.task_areas
  for select to authenticated
  using (exists (select 1 from docket.tasks t
                 where t.id = task_id and t.created_by = (select auth.uid())));
create policy "task_areas: add own" on docket.task_areas
  for insert to authenticated
  with check (
    exists (select 1 from docket.tasks t
            where t.id = task_id and t.created_by = (select auth.uid()))
    and exists (select 1 from docket.areas a
                where a.id = area_id and a.owner_id = (select auth.uid()))
  );
create policy "task_areas: delete own" on docket.task_areas
  for delete to authenticated
  using (exists (select 1 from docket.tasks t
                 where t.id = task_id and t.created_by = (select auth.uid())));


-- ---------------------------------------------------------------
-- Starter areas. The app calls this once after sign-in; it does
-- nothing if you already have areas. RLS stops anyone seeding
-- areas for another person.
-- ---------------------------------------------------------------
create or replace function docket.seed_starter_areas(p_user uuid default auth.uid())
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_user is null then
    raise exception 'seed_starter_areas: no user id given';
  end if;

  if exists (select 1 from docket.areas where owner_id = p_user) then
    return;
  end if;

  insert into docket.areas (owner_id, name, color, sort_order) values
    (p_user, 'Work',     '#2B45C9', 1),
    (p_user, 'Home',     '#0F7A6E', 2),
    (p_user, 'Rentals',  '#8A3FA0', 3),
    (p_user, 'Ministry', '#B86E00', 4);
end;
$$;


-- ---------------------------------------------------------------
-- Grants: signed-in users may use the tables (RLS still decides
-- which rows). Signed-out visitors get nothing.
-- ---------------------------------------------------------------
grant select, insert, update, delete on all tables in schema docket to authenticated;
grant all on all tables in schema docket to service_role;
grant execute on function docket.seed_starter_areas(uuid) to authenticated;
revoke execute on function docket.seed_starter_areas(uuid) from anon, public;

alter default privileges in schema docket
  grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema docket
  grant all on tables to service_role;
