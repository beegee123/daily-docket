-- Daily Docket, step 16c: one-day and timed events
-- An event can now have a start time (and an optional end time).
-- No start time = all day, which is what every existing event stays.
-- time_zone is where the time was entered, so the calendar feed puts a
-- 2:00 pm exam at 2:00 pm New York time even when viewed from Chicago.
--
-- Run after 015. Safe to re-run.

alter table docket.events add column if not exists start_time time;
alter table docket.events add column if not exists end_time   time;
alter table docket.events add column if not exists time_zone  text not null default 'America/New_York';

-- An end time needs a start time
alter table docket.events drop constraint if exists events_end_time_needs_start;
alter table docket.events add constraint events_end_time_needs_start
  check (end_time is null or start_time is not null);

-- On a one-day event, the end time comes after the start time
alter table docket.events drop constraint if exists events_times_in_order;
alter table docket.events add constraint events_times_in_order
  check (end_time is null or end_date > start_date or end_time > start_time);

-- Reject a time zone Postgres doesn't know
create or replace function docket.check_event_time_zone()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform now() at time zone new.time_zone;
  return new;
end;
$$;

drop trigger if exists events_check_time_zone on docket.events;
create trigger events_check_time_zone
  before insert or update of time_zone on docket.events
  for each row execute function docket.check_event_time_zone();


-- The calendar feed now needs the times too. Its columns change, so the
-- old version is dropped first (Postgres can't change them in place).
drop function if exists docket.feed_events(uuid, date);
create function docket.feed_events(p_user uuid, p_from date)
returns table (
  id           uuid,
  title        text,
  start_date   date,
  end_date     date,
  start_time   time,
  end_time     time,
  time_zone    text,
  notes        text,
  updated_at   timestamptz,
  area_name    text,
  person_id    uuid,
  person_email text
)
language sql
stable
security definer
set search_path = ''
as $$
  select e.id, e.title, e.start_date, e.end_date, e.start_time, e.end_time, e.time_zone,
         e.notes, e.updated_at, a.name, e.person_id, u.email::text
  from docket.events e
  join docket.areas a on a.id = e.area_id
  left join auth.users u on u.id = e.person_id
  where e.end_date >= p_from
    and (a.owner_id = p_user
         or exists (select 1 from docket.area_members m
                    where m.area_id = a.id and m.user_id = p_user))
  order by e.start_date, e.start_time nulls first, e.title
  limit 1000;
$$;

revoke execute on function docket.feed_events(uuid, date) from public, anon, authenticated;
grant execute on function docket.feed_events(uuid, date) to service_role;
