-- Daily Docket, step 21: Schedule on Today, and reminders
--
--  * Meetings (events with a start time) get a reminder choice:
--    5, 10, 15, 30 or 60 minutes before, or none.
--  * Tasks get "Remind me at" a time on the task's day. The time follows
--    the task: if it carries over or moves, the reminder moves with it.
--  * Settings: meeting reminders on/off, and the default for new meetings.
--  * "Attended" ticks on meetings, one per person (ticking a shared
--    meeting only marks it for you).
--  * Every 5 minutes the server sends what's due and records each one
--    in reminders_sent, so nothing is sent twice.
--
-- Who gets a meeting reminder: everyone who shares the meeting's area and
-- has meeting reminders on. A task reminder goes to the person it's
-- assigned to, or whoever added it if it isn't assigned.
--
-- Run after 020. Uses the same Vault secret as the morning digest
-- (010), so there is nothing to paste. Safe to re-run.
-- Then redeploy send-digest (it now sends reminders too).

-- ---------------------------------------------------------------
-- New columns
-- ---------------------------------------------------------------

-- Minutes before the start; null = no reminder
alter table docket.events add column if not exists remind_minutes smallint;
alter table docket.events drop constraint if exists events_remind_minutes_allowed;
alter table docket.events add constraint events_remind_minutes_allowed
  check (remind_minutes is null or remind_minutes in (5, 10, 15, 30, 60));

-- A time on the task's day; null = no reminder.
-- (001 made remind_at / reminded_at as full timestamps. They were never
-- used, and a fixed timestamp wouldn't follow a task that carries over,
-- so this time-of-day column replaces them. They're left in place.)
alter table docket.tasks add column if not exists remind_time time;

alter table docket.user_settings add column if not exists meeting_reminders boolean not null default true;
alter table docket.user_settings add column if not exists remind_default smallint not null default 10;
alter table docket.user_settings drop constraint if exists user_settings_remind_default_allowed;
alter table docket.user_settings add constraint user_settings_remind_default_allowed
  check (remind_default in (5, 10, 15, 30, 60));


-- ---------------------------------------------------------------
-- Attended: one row per person per meeting they ticked
-- ---------------------------------------------------------------
create table if not exists docket.event_attendance (
  event_id    uuid not null references docket.events (id) on delete cascade,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  attended_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

create index if not exists event_attendance_by_user on docket.event_attendance (user_id);

-- The meeting's area, without tripping over the events table's own rules
create or replace function docket.can_see_event(p_event uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from docket.events e where e.id = p_event and docket.can_see_area(e.area_id));
$$;
revoke execute on function docket.can_see_event(uuid) from public, anon;
grant execute on function docket.can_see_event(uuid) to authenticated;

alter table docket.event_attendance enable row level security;

drop policy if exists "attendance: read own"   on docket.event_attendance;
drop policy if exists "attendance: add own"    on docket.event_attendance;
drop policy if exists "attendance: delete own" on docket.event_attendance;

create policy "attendance: read own" on docket.event_attendance
  for select to authenticated
  using (user_id = (select auth.uid()));
create policy "attendance: add own" on docket.event_attendance
  for insert to authenticated
  with check (user_id = (select auth.uid()) and docket.can_see_event(event_id));
create policy "attendance: delete own" on docket.event_attendance
  for delete to authenticated
  using (user_id = (select auth.uid()));

grant select, insert, delete on docket.event_attendance to authenticated;
grant all on docket.event_attendance to service_role;

-- Live sync: tick on the phone, it shows ticked on the computer
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'docket' and tablename = 'event_attendance'
  ) then
    alter publication supabase_realtime add table docket.event_attendance;
  end if;
end;
$$;


-- ---------------------------------------------------------------
-- What has been sent. fire_at is part of the key, so moving a meeting
-- or a task to another time gives it a fresh reminder.
-- Server only: no policies, so the app can't read or change it.
-- ---------------------------------------------------------------
create table if not exists docket.reminders_sent (
  kind     text not null check (kind in ('event', 'task')),
  item_id  uuid not null,
  user_id  uuid not null references auth.users (id) on delete cascade,
  fire_at  timestamptz not null,
  sent_at  timestamptz not null default now(),
  primary key (kind, item_id, user_id, fire_at)
);

alter table docket.reminders_sent enable row level security;
revoke all on docket.reminders_sent from anon, authenticated;
grant all on docket.reminders_sent to service_role;


-- ---------------------------------------------------------------
-- Which reminders are due right now? Records them as sent in the same
-- statement, so two overlapping runs never send the same one twice.
--
-- Due = its time has come, within the last 20 minutes (a late run still
-- sends it; a very late one doesn't send something stale), the meeting
-- hasn't started, the task isn't done, and the person has at least one
-- device with notifications on.
-- Only the server (service_role) may call this.
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
  with meetings as (
    select e.id, e.title, e.area_id, e.start_time, e.end_time,
           ((e.start_date + e.start_time) at time zone e.time_zone) as starts_at,
           ((e.start_date + e.start_time) at time zone e.time_zone)
             - make_interval(mins => e.remind_minutes) as fire_at
      from docket.events e
     where e.start_time is not null
       and e.remind_minutes is not null
       -- cheap first cut on the date; the exact check is below
       and e.start_date between (p_now - interval '2 days')::date and (p_now + interval '2 days')::date
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
    -- Keep the table small: a week of history is plenty
    delete from docket.reminders_sent where reminders_sent.fire_at < p_now - interval '7 days'
  )
  select r.kind, r.item_id, r.user_id, r.fire_at, r.starts_at, r.title, r.area_name, r.start_time, r.end_time
    from reachable r
    join claimed c on c.kind = r.kind and c.item_id = r.item_id and c.user_id = r.user_id and c.fire_at = r.fire_at;
$$;

revoke execute on function docket.claim_reminders(timestamptz) from public, anon, authenticated;
grant execute on function docket.claim_reminders(timestamptz) to service_role;


-- A reminder that reached no device: forget it was sent, so the next run
-- (5 minutes later) tries again while it's still within its 20 minutes.
create or replace function docket.release_reminder(p_kind text, p_item uuid, p_user uuid, p_fire_at timestamptz)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from docket.reminders_sent
   where kind = p_kind and item_id = p_item and user_id = p_user and fire_at = p_fire_at;
$$;

revoke execute on function docket.release_reminder(text, uuid, uuid, timestamptz) from public, anon, authenticated;
grant execute on function docket.release_reminder(text, uuid, uuid, timestamptz) to service_role;


-- ---------------------------------------------------------------
-- Run every 5 minutes. Same function and secret as the morning digest;
-- the body tells it this run is for reminders.
-- ---------------------------------------------------------------
select cron.unschedule(jobid) from cron.job where jobname = 'docket-reminders';

select cron.schedule(
  'docket-reminders',
  '*/5 * * * *',
  $job$
  select net.http_post(
    url     := 'https://cqiwinquzfynelkmeywc.supabase.co/functions/v1/send-digest',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'docket_cron_secret')
    ),
    body    := '{"job": "reminders"}'::jsonb,
    timeout_milliseconds := 15000
  );
  $job$
);

-- Check: should list both jobs, active
select jobid, jobname, schedule, active from cron.job where jobname in ('docket-morning-digest', 'docket-reminders');
