-- Daily Docket, step 21b: repeating meetings
-- Enter the Monday stand-up once. Only the pattern is stored; the app,
-- the reminders and the calendar feed work out the dates from it.
--
--   repeat        null = never, 'weekdays', 'weekly', 'biweekly', 'monthly'
--   repeat_days   for weekly / every 2 weeks: ISO weekdays, 1 = Mon ... 7 = Sun
--   repeat_until  last day it can happen (optional)
--   start_date    the first day; every 2 weeks counts from its week,
--                 every month uses its day of the month
--
-- "Not this time" adds a row to event_skips. "Just this one" turns that
-- date into its own one-off event; "This and later ones" ends the series
-- the day before and starts a new one (functions below).
-- Attended ticks are now kept per date.
--
-- Run after 021. Safe to re-run. Then redeploy calendar-feed.

-- ---------------------------------------------------------------
-- The pattern
-- ---------------------------------------------------------------
alter table docket.events add column if not exists repeat       text;
alter table docket.events add column if not exists repeat_days  smallint[];
alter table docket.events add column if not exists repeat_until date;

alter table docket.events drop constraint if exists events_repeat_allowed;
alter table docket.events add constraint events_repeat_allowed check (
  repeat is null
  or (
    repeat in ('weekdays', 'weekly', 'biweekly', 'monthly')
    -- a one-day event, not a trip
    and end_date = start_date
    and person_id is null
    and (repeat_until is null or repeat_until >= start_date)
    and (repeat not in ('weekly', 'biweekly')
         or (cardinality(coalesce(repeat_days, '{}')) between 1 and 7
             and repeat_days <@ array[1,2,3,4,5,6,7]::smallint[]))
  )
);

create index if not exists events_repeating on docket.events (area_id) where repeat is not null;

-- Does a pattern fall on this day? Same rules as src/lib/repeat.js.
create or replace function docket.occurs_on(
  p_repeat text, p_days smallint[], p_start date, p_until date, p_day date
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_day >= p_start
     and (p_until is null or p_day <= p_until)
     and case p_repeat
           when 'weekdays' then extract(isodow from p_day) between 1 and 5
           when 'weekly'   then extract(isodow from p_day)::smallint = any (p_days)
           when 'biweekly' then extract(isodow from p_day)::smallint = any (p_days)
                                and ((date_trunc('week', p_day)::date - date_trunc('week', p_start)::date) / 7) % 2 = 0
           when 'monthly'  then extract(day from p_day) = extract(day from p_start)
           else p_day = p_start
         end;
$$;
grant execute on function docket.occurs_on(text, smallint[], date, date, date) to authenticated, service_role;


-- ---------------------------------------------------------------
-- "Not this time": dates skipped in a series
-- ---------------------------------------------------------------
create table if not exists docket.event_skips (
  event_id   uuid not null references docket.events (id) on delete cascade,
  on_date    date not null,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (event_id, on_date)
);

alter table docket.event_skips enable row level security;

drop policy if exists "skips: read"   on docket.event_skips;
drop policy if exists "skips: add"    on docket.event_skips;
drop policy if exists "skips: delete" on docket.event_skips;

-- Same as the series: anyone who shares its area
create policy "skips: read" on docket.event_skips
  for select to authenticated using (docket.can_see_event(event_id));
create policy "skips: add" on docket.event_skips
  for insert to authenticated with check (docket.can_see_event(event_id));
create policy "skips: delete" on docket.event_skips
  for delete to authenticated using (docket.can_see_event(event_id));

grant select, insert, delete on docket.event_skips to authenticated;
grant all on docket.event_skips to service_role;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'docket' and tablename = 'event_skips'
  ) then
    alter publication supabase_realtime add table docket.event_skips;
  end if;
end;
$$;


-- ---------------------------------------------------------------
-- Attended, per date: ticking this Monday doesn't tick next Monday
-- ---------------------------------------------------------------
alter table docket.event_attendance add column if not exists on_date date;
update docket.event_attendance a
   set on_date = e.start_date
  from docket.events e
 where e.id = a.event_id and a.on_date is null;
alter table docket.event_attendance alter column on_date set not null;

do $$
begin
  -- Swap the key from (event, person) to (event, person, date), once
  if exists (
    select 1 from pg_constraint
     where conname = 'event_attendance_pkey'
       and conrelid = 'docket.event_attendance'::regclass
       and cardinality(conkey) = 2
  ) then
    alter table docket.event_attendance drop constraint event_attendance_pkey;
    alter table docket.event_attendance add primary key (event_id, user_id, on_date);
  end if;
end;
$$;


-- ---------------------------------------------------------------
-- Editing one date of a series
-- Both copy the event as it is; the app then saves the changes to the
-- copy like any other edit. Both run with your own permissions.
-- ---------------------------------------------------------------

-- "Just this one": that date becomes its own event, and the series skips it.
create or replace function docket.detach_occurrence(p_event uuid, p_date date)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  e docket.events;
  v_new uuid;
begin
  select * into e from docket.events where id = p_event;
  if not found then raise exception 'That event no longer exists.'; end if;
  if e.repeat is null then return p_event; end if;
  if not docket.occurs_on(e.repeat, e.repeat_days, e.start_date, e.repeat_until, p_date) then
    raise exception 'That date isn''t part of this series.';
  end if;

  insert into docket.events (area_id, title, start_date, end_date, start_time, end_time,
                             time_zone, notes, remind_minutes)
  values (e.area_id, e.title, p_date, p_date, e.start_time, e.end_time,
          e.time_zone, e.notes, e.remind_minutes)
  returning id into v_new;

  insert into docket.event_skips (event_id, on_date) values (p_event, p_date)
  on conflict do nothing;

  -- Your tick for that date moves with it (ticks can be added and
  -- removed but not changed, so it's moved by delete + insert)
  with moved as (
    delete from docket.event_attendance
     where event_id = p_event and on_date = p_date and user_id = auth.uid()
    returning on_date, attended_at
  )
  insert into docket.event_attendance (event_id, user_id, on_date, attended_at)
  select v_new, auth.uid(), on_date, attended_at from moved;

  return v_new;
end;
$$;

-- "This and later ones": the series ends the day before, and a copy
-- carries on from that date. From the first date, it's simply the series.
create or replace function docket.split_series(p_event uuid, p_date date)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  e docket.events;
  v_new uuid;
begin
  select * into e from docket.events where id = p_event;
  if not found then raise exception 'That event no longer exists.'; end if;
  if e.repeat is null or p_date <= e.start_date then return p_event; end if;

  insert into docket.events (area_id, title, start_date, end_date, start_time, end_time,
                             time_zone, notes, remind_minutes, repeat, repeat_days, repeat_until)
  values (e.area_id, e.title, p_date, p_date, e.start_time, e.end_time,
          e.time_zone, e.notes, e.remind_minutes, e.repeat, e.repeat_days, e.repeat_until)
  returning id into v_new;

  update docket.events set repeat_until = p_date - 1 where id = p_event;

  -- Skips and your ticks from that date on belong to the new series
  with moved as (
    delete from docket.event_skips where event_id = p_event and on_date >= p_date
    returning on_date
  )
  insert into docket.event_skips (event_id, on_date) select v_new, on_date from moved;

  with moved as (
    delete from docket.event_attendance
     where event_id = p_event and on_date >= p_date and user_id = auth.uid()
    returning on_date, attended_at
  )
  insert into docket.event_attendance (event_id, user_id, on_date, attended_at)
  select v_new, auth.uid(), on_date, attended_at from moved;

  return v_new;
end;
$$;

-- "Delete this and later ones": end the series the day before.
-- From the first date, that's the whole series, so it's deleted.
create or replace function docket.end_series(p_event uuid, p_date date)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  e docket.events;
begin
  select * into e from docket.events where id = p_event;
  if not found then raise exception 'That event no longer exists.'; end if;
  if p_date <= e.start_date then
    delete from docket.events where id = p_event;
  else
    update docket.events set repeat_until = p_date - 1 where id = p_event;
    delete from docket.event_skips where event_id = p_event and on_date >= p_date;
  end if;
end;
$$;

revoke execute on function docket.detach_occurrence(uuid, date) from public, anon;
revoke execute on function docket.split_series(uuid, date) from public, anon;
revoke execute on function docket.end_series(uuid, date) from public, anon;
grant execute on function docket.detach_occurrence(uuid, date) to authenticated;
grant execute on function docket.split_series(uuid, date) to authenticated;
grant execute on function docket.end_series(uuid, date) to authenticated;


-- ---------------------------------------------------------------
-- Reminders (from 021) now include each date of a series
-- ---------------------------------------------------------------
create or replace function docket.claim_reminders(p_now timestamptz default now())
returns table (
  kind        text,
  item_id     uuid,
  user_id     uuid,
  fire_at     timestamptz,
  starts_at   timestamptz,   -- meetings only
  title       text,
  area_name   text,
  start_time  time,          -- meetings only, as entered
  end_time    time
)
language sql
security definer
set search_path = ''
as $$
  with days as (
    -- yesterday to the day after tomorrow covers every time zone and the 1-hour reminder
    select d::date as day
      from generate_series((p_now - interval '1 day')::date, (p_now + interval '2 days')::date, interval '1 day') d
  ),
  meetings as (
    select e.id, e.title, e.area_id, e.start_time, e.end_time,
           ((d.day + e.start_time) at time zone e.time_zone) as starts_at,
           ((d.day + e.start_time) at time zone e.time_zone)
             - make_interval(mins => e.remind_minutes) as fire_at
      from docket.events e
      join days d
        on docket.occurs_on(e.repeat, e.repeat_days, e.start_date, e.repeat_until, d.day)
     where e.start_time is not null
       and e.remind_minutes is not null
       and e.start_date <= (p_now + interval '2 days')::date
       and (e.repeat is not null or e.start_date >= (p_now - interval '1 day')::date)
       and not exists (select 1 from docket.event_skips s where s.event_id = e.id and s.on_date = d.day)
  ),
  people_in_area as (
    select a.id as area_id, a.owner_id as user_id from docket.areas a
    union
    select m.area_id, m.user_id from docket.area_members m where m.user_id is not null
  ),
  due_meetings as (
    select 'event'::text as kind, mt.id as item_id, p.user_id, mt.fire_at, mt.starts_at,
           mt.title, a.name as area_name, mt.start_time, mt.end_time
      from meetings mt
      join people_in_area p on p.area_id = mt.area_id
      join docket.areas a on a.id = mt.area_id
      left join docket.user_settings s on s.user_id = p.user_id
     where mt.fire_at <= p_now
       and mt.fire_at >  p_now - interval '20 minutes'
       and mt.starts_at > p_now
       and coalesce(s.meeting_reminders, true)
  ),
  due_tasks as (
    select 'task'::text as kind, t.id as item_id, x.user_id,
           ((t.scheduled_date + t.remind_time) at time zone coalesce(s.timezone, 'America/New_York')) as fire_at,
           null::timestamptz as starts_at,
           t.title, first_area.name as area_name, null::time as start_time, null::time as end_time
      from docket.tasks t
      cross join lateral (select coalesce(t.assigned_to, t.created_by) as user_id) x
      left join docket.user_settings s on s.user_id = x.user_id
      left join lateral (
        select a.name from docket.task_areas ta join docket.areas a on a.id = ta.area_id
         where ta.task_id = t.id order by a.name limit 1
      ) first_area on true
     where t.remind_time is not null
       and t.scheduled_date between (p_now - interval '2 days')::date and (p_now + interval '2 days')::date
       and t.status <> 'done'
       and t.dropped_at is null
  ),
  candidates as (
    select * from due_meetings
    union all
    select * from due_tasks
     where fire_at <= p_now and fire_at > p_now - interval '20 minutes'
  ),
  reachable as (
    select c.* from candidates c
     where exists (select 1 from docket.push_subscriptions ps where ps.user_id = c.user_id)
  ),
  claimed as (
    insert into docket.reminders_sent (kind, item_id, user_id, fire_at)
    select r.kind, r.item_id, r.user_id, r.fire_at from reachable r
    on conflict do nothing
    returning reminders_sent.kind, reminders_sent.item_id, reminders_sent.user_id, reminders_sent.fire_at
  ),
  tidy as (
    delete from docket.reminders_sent where reminders_sent.fire_at < p_now - interval '7 days'
  )
  select r.kind, r.item_id, r.user_id, r.fire_at, r.starts_at, r.title, r.area_name, r.start_time, r.end_time
    from reachable r
    join claimed c on c.kind = r.kind and c.item_id = r.item_id and c.user_id = r.user_id and c.fire_at = r.fire_at;
$$;

revoke execute on function docket.claim_reminders(timestamptz) from public, anon, authenticated;
grant execute on function docket.claim_reminders(timestamptz) to service_role;


-- ---------------------------------------------------------------
-- Calendar feed: a series goes out once, with its pattern and skipped
-- dates, and Google draws the repeats. Columns change, so drop first.
-- ---------------------------------------------------------------
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
  person_email text,
  repeat       text,
  repeat_days  smallint[],
  repeat_until date,
  skip_dates   date[]
)
language sql
stable
security definer
set search_path = ''
as $$
  select e.id, e.title, e.start_date, e.end_date, e.start_time, e.end_time, e.time_zone,
         e.notes, e.updated_at, a.name, e.person_id, u.email::text,
         e.repeat, e.repeat_days, e.repeat_until,
         coalesce((select array_agg(s.on_date order by s.on_date) from docket.event_skips s where s.event_id = e.id),
                  '{}'::date[])
  from docket.events e
  join docket.areas a on a.id = e.area_id
  left join auth.users u on u.id = e.person_id
  where (e.end_date >= p_from
         or (e.repeat is not null and (e.repeat_until is null or e.repeat_until >= p_from)))
    and (a.owner_id = p_user
         or exists (select 1 from docket.area_members m
                    where m.area_id = a.id and m.user_id = p_user))
  order by e.start_date, e.start_time nulls first, e.title
  limit 1000;
$$;

revoke execute on function docket.feed_events(uuid, date) from public, anon, authenticated;
grant execute on function docket.feed_events(uuid, date) to service_role;
