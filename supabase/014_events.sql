-- Daily Docket, step 16: trips and events
-- Dated items people in an area can see. They never carry over.
-- person_id = who's away (a trip); empty = a plain event ("PD1 exam").
-- Run after 012. Safe to re-run.

create table if not exists docket.events (
  id          uuid primary key default gen_random_uuid(),
  area_id     uuid not null references docket.areas (id) on delete cascade,
  created_by  uuid not null default auth.uid() references auth.users (id) on delete cascade,
  person_id   uuid references auth.users (id) on delete set null,
  title       text not null check (char_length(trim(title)) between 1 and 120),
  start_date  date not null,
  end_date    date not null,
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint events_dates_in_order check (end_date >= start_date)
);

create index if not exists events_by_area_dates on docket.events (area_id, end_date, start_date);

drop trigger if exists events_set_updated_at on docket.events;
create trigger events_set_updated_at
  before update on docket.events
  for each row execute function docket.set_updated_at();

-- Who's away must be someone in that area (its owner or a joined member)
create or replace function docket.check_event_person()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.person_id is not null and not exists (
       select 1 from docket.areas a
       where a.id = new.area_id
         and (a.owner_id = new.person_id
              or exists (select 1 from docket.area_members m
                         where m.area_id = a.id and m.user_id = new.person_id))
     ) then
    raise exception 'Only someone who shares this area can be marked as away.';
  end if;
  return new;
end;
$$;

drop trigger if exists events_check_person on docket.events;
create trigger events_check_person
  before insert or update of person_id, area_id on docket.events
  for each row execute function docket.check_event_person();

-- Same visibility as the area: anyone who can see the area can see, add,
-- edit and delete its events (a shared calendar)
alter table docket.events enable row level security;

drop policy if exists "events: read"   on docket.events;
drop policy if exists "events: add"    on docket.events;
drop policy if exists "events: change" on docket.events;
drop policy if exists "events: delete" on docket.events;

create policy "events: read" on docket.events
  for select to authenticated
  using (docket.can_see_area(area_id));
create policy "events: add" on docket.events
  for insert to authenticated
  with check (created_by = (select auth.uid()) and docket.can_see_area(area_id));
create policy "events: change" on docket.events
  for update to authenticated
  using (docket.can_see_area(area_id))
  with check (docket.can_see_area(area_id));
create policy "events: delete" on docket.events
  for delete to authenticated
  using (docket.can_see_area(area_id));

grant select, insert, update, delete on docket.events to authenticated;
grant all on docket.events to service_role;

-- Live sync: a trip added on one phone shows on the other
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'docket' and tablename = 'events'
  ) then
    alter publication supabase_realtime add table docket.events;
  end if;
end;
$$;
