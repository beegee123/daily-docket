-- Daily Docket, step 14: share an area
-- An owner can share an area by email. Members see, add, tick and edit
-- that area's tasks. Everything else stays private.
-- Run after 001-011. Safe to re-run.

-- ---------------------------------------------------------------
-- Who an area is shared with
-- user_id stays empty until the invited person opens the app signed in
-- with that (confirmed) email address.
-- ---------------------------------------------------------------
create table if not exists docket.area_members (
  id             uuid primary key default gen_random_uuid(),
  area_id        uuid not null references docket.areas (id) on delete cascade,
  invited_email  text not null check (invited_email = lower(trim(invited_email)) and invited_email like '%_@_%'),
  user_id        uuid references auth.users (id) on delete cascade,
  invited_by     uuid default auth.uid() references auth.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  accepted_at    timestamptz,
  unique (area_id, invited_email)
);

create index if not exists area_members_by_user on docket.area_members (user_id);
create unique index if not exists area_members_one_per_user
  on docket.area_members (area_id, user_id) where user_id is not null;


-- ---------------------------------------------------------------
-- Helpers for the security rules.
-- They run with the owner's rights (security definer) so the rules can
-- look things up without tripping over their own rules (which would loop).
-- Each one only answers yes/no about the signed-in person.
-- ---------------------------------------------------------------
create or replace function docket.owns_area(p_area uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from docket.areas where id = p_area and owner_id = auth.uid());
$$;

create or replace function docket.can_see_area(p_area uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from docket.areas where id = p_area and owner_id = auth.uid())
      or exists (select 1 from docket.area_members
                 where area_id = p_area and user_id = auth.uid());
$$;

-- A task is visible if you made it, or it's in an area you own or share
create or replace function docket.can_see_task(p_task uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from docket.tasks where id = p_task and created_by = auth.uid())
      or exists (
           select 1
           from docket.task_areas ta
           where ta.task_id = p_task
             and (exists (select 1 from docket.areas a where a.id = ta.area_id and a.owner_id = auth.uid())
                  or exists (select 1 from docket.area_members m
                             where m.area_id = ta.area_id and m.user_id = auth.uid()))
         );
$$;

revoke execute on function docket.owns_area(uuid) from public, anon;
revoke execute on function docket.can_see_area(uuid) from public, anon;
revoke execute on function docket.can_see_task(uuid) from public, anon;
grant execute on function docket.owns_area(uuid) to authenticated;
grant execute on function docket.can_see_area(uuid) to authenticated;
grant execute on function docket.can_see_task(uuid) to authenticated;


-- ---------------------------------------------------------------
-- New security rules (replacing the "own rows only" ones from 001)
-- ---------------------------------------------------------------

-- Areas: see your own and those shared with you; only the owner changes them
drop policy if exists "areas: read own"   on docket.areas;
drop policy if exists "areas: add own"    on docket.areas;
drop policy if exists "areas: change own" on docket.areas;
drop policy if exists "areas: delete own" on docket.areas;
drop policy if exists "areas: read own or shared" on docket.areas;

create policy "areas: read own or shared" on docket.areas
  for select to authenticated
  using (docket.can_see_area(id));
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

-- Tasks: see and change yours plus those in shared areas; delete only yours
drop policy if exists "tasks: read own"   on docket.tasks;
drop policy if exists "tasks: add own"    on docket.tasks;
drop policy if exists "tasks: change own" on docket.tasks;
drop policy if exists "tasks: delete own" on docket.tasks;
drop policy if exists "tasks: read own or shared"   on docket.tasks;
drop policy if exists "tasks: change own or shared" on docket.tasks;

create policy "tasks: read own or shared" on docket.tasks
  for select to authenticated
  using (created_by = (select auth.uid()) or docket.can_see_task(id));
create policy "tasks: add own" on docket.tasks
  for insert to authenticated
  with check (created_by = (select auth.uid()));
create policy "tasks: change own or shared" on docket.tasks
  for update to authenticated
  using (created_by = (select auth.uid()) or docket.can_see_task(id))
  with check (created_by = (select auth.uid()) or docket.can_see_task(id));
create policy "tasks: delete own" on docket.tasks
  for delete to authenticated
  using (created_by = (select auth.uid()));

-- Task <-> area links: only between tasks and areas you can both see.
-- So a member never sees which of your private areas a shared task is in.
drop policy if exists "task_areas: read own"   on docket.task_areas;
drop policy if exists "task_areas: add own"    on docket.task_areas;
drop policy if exists "task_areas: delete own" on docket.task_areas;
drop policy if exists "task_areas: read visible"   on docket.task_areas;
drop policy if exists "task_areas: add visible"    on docket.task_areas;
drop policy if exists "task_areas: delete visible" on docket.task_areas;

create policy "task_areas: read visible" on docket.task_areas
  for select to authenticated
  using (docket.can_see_task(task_id) and docket.can_see_area(area_id));
create policy "task_areas: add visible" on docket.task_areas
  for insert to authenticated
  with check (docket.can_see_task(task_id) and docket.can_see_area(area_id));
create policy "task_areas: delete visible" on docket.task_areas
  for delete to authenticated
  using (docket.can_see_task(task_id) and docket.can_see_area(area_id));

-- Members: everyone in an area can see who's in it; the owner invites and
-- removes; a member can remove themselves (leave)
alter table docket.area_members enable row level security;

drop policy if exists "members: read" on docket.area_members;
drop policy if exists "members: owner invites" on docket.area_members;
drop policy if exists "members: owner removes or member leaves" on docket.area_members;

create policy "members: read" on docket.area_members
  for select to authenticated
  using (docket.can_see_area(area_id));
create policy "members: owner invites" on docket.area_members
  for insert to authenticated
  with check (docket.owns_area(area_id));
create policy "members: owner removes or member leaves" on docket.area_members
  for delete to authenticated
  using (docket.owns_area(area_id) or user_id = (select auth.uid()));

grant select, insert, delete on docket.area_members to authenticated;
grant all on docket.area_members to service_role;


-- ---------------------------------------------------------------
-- Inviting and joining
-- ---------------------------------------------------------------

-- Owner invites an email address to one of their areas
create or replace function docket.invite_to_area(p_area uuid, p_email text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(trim(p_email));
  v_mine  text;
begin
  if auth.uid() is null then
    raise exception 'Please sign in again.';
  end if;
  if not docket.owns_area(p_area) then
    raise exception 'Only the owner can share this area.';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'That doesn''t look like an email address.';
  end if;
  select lower(email) into v_mine from auth.users where id = auth.uid();
  if v_email = v_mine then
    raise exception 'That''s your own email address.';
  end if;

  insert into docket.area_members (area_id, invited_email, invited_by)
  values (p_area, v_email, auth.uid())
  on conflict (area_id, invited_email) do nothing;
end;
$$;

-- Called by the app on start-up: join every area waiting for my email.
-- The email must be confirmed, so nobody can claim an invite by signing
-- up with someone else's address.
create or replace function docket.accept_my_invites()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  if auth.uid() is null then
    return 0;
  end if;

  update docket.area_members m
     set user_id = auth.uid(),
         accepted_at = now()
    from auth.users u
   where u.id = auth.uid()
     and u.email_confirmed_at is not null
     and m.invited_email = lower(u.email)
     and m.user_id is null
     and not exists (select 1 from docket.areas a where a.id = m.area_id and a.owner_id = auth.uid());

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Everyone I share at least one area with (not me), for "added by" tags
create or replace function docket.my_people()
returns table (user_id uuid, email text)
language sql
stable
security definer
set search_path = ''
as $$
  with my_areas as (
    select a.id from docket.areas a where a.owner_id = auth.uid()
    union
    select m.area_id from docket.area_members m where m.user_id = auth.uid()
  ),
  people as (
    select a.owner_id as uid from docket.areas a join my_areas x on x.id = a.id
    union
    select m.user_id from docket.area_members m join my_areas x on x.id = m.area_id
    where m.user_id is not null
  )
  select u.id, u.email::text
  from people p
  join auth.users u on u.id = p.uid
  where p.uid <> auth.uid();
$$;

revoke execute on function docket.invite_to_area(uuid, text) from public, anon;
revoke execute on function docket.accept_my_invites() from public, anon;
revoke execute on function docket.my_people() from public, anon;
grant execute on function docket.invite_to_area(uuid, text) to authenticated;
grant execute on function docket.accept_my_invites() to authenticated;
grant execute on function docket.my_people() to authenticated;


-- ---------------------------------------------------------------
-- Your own actions stay your own:
-- Close the day, Reopen, Shift plan and their Undo only ever move tasks
-- YOU created, never a shared task someone else added.
-- ---------------------------------------------------------------
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
         and created_by = auth.uid()
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
         and created_by = auth.uid()
         and status <> 'done'
         and dropped_at is null;
      get diagnostics v_count = row_count;
      v_moved := v_moved + v_count;

    elsif v_item->>'action' = 'restore' then
      update docket.tasks
         set dropped_at     = null,
             scheduled_date = coalesce((v_item->>'date')::date, scheduled_date)
       where id = (v_item->>'id')::uuid
         and created_by = auth.uid()
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
     and t.created_by = auth.uid()
     and (i->>'scheduled_date') is not null
     and t.status <> 'done'
     and t.dropped_at is null;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- delete_area: only the owner, and "at least one area" means one you own
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

  if not docket.owns_area(p_area) then
    raise exception 'Only the owner can delete this area.';
  end if;

  if (select count(*) from docket.areas where owner_id = auth.uid()) <= 1 then
    raise exception 'You need at least one area.';
  end if;

  select count(*) into v_tasks from docket.task_areas where area_id = p_area;

  if v_tasks > 0 then
    if p_move_to is null or p_move_to = p_area then
      raise exception 'Choose another area for this area''s tasks first.';
    end if;
    if not docket.owns_area(p_move_to) then
      raise exception 'Move the tasks to one of your own areas.';
    end if;

    insert into docket.task_areas (task_id, area_id)
    select task_id, p_move_to from docket.task_areas where area_id = p_area
    on conflict do nothing;
    get diagnostics v_moved = row_count;
  end if;

  delete from docket.areas where id = p_area;
  return v_moved;
end;
$$;


-- Live sync for joining and leaving
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'docket' and tablename = 'area_members'
  ) then
    alter publication supabase_realtime add table docket.area_members;
  end if;
end;
$$;
