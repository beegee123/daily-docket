-- Daily Docket, steps 17-18: repeating tasks and routines
-- Set something up once and it lands on Today by itself.
--
-- A repeat rule says what (a routine, or a title and notes), where (one
-- area, optionally assigned), when (the same patterns as repeating
-- meetings, plus 'daily') and what happens if it isn't done:
--   'fresh'  a copy left unfinished is removed the next morning, and the
--            new day's copy arrives with every step unticked (routines)
--   'carry'  it carries over like any task, and no new copy is added
--            until it's done ("Pay rent")
--
-- Each copy is an ordinary task with rule_id and rule_date, one per rule
-- per date, so making copies twice never doubles up.
--
-- Run after 022. Safe to re-run.

-- ---------------------------------------------------------------
-- 'daily' joins the patterns (events don't offer it)
-- ---------------------------------------------------------------
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
           when 'daily'    then true
           when 'weekdays' then extract(isodow from p_day) between 1 and 5
           when 'weekly'   then extract(isodow from p_day)::smallint = any (p_days)
           when 'biweekly' then extract(isodow from p_day)::smallint = any (p_days)
                                and ((date_trunc('week', p_day)::date - date_trunc('week', p_start)::date) / 7) % 2 = 0
           when 'monthly'  then extract(day from p_day) = extract(day from p_start)
           else p_day = p_start
         end;
$$;


-- ---------------------------------------------------------------
-- The rules
-- ---------------------------------------------------------------
create table if not exists docket.repeat_rules (
  id            uuid primary key default gen_random_uuid(),
  area_id       uuid not null references docket.areas (id) on delete cascade,
  created_by    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  assigned_to   uuid references auth.users (id) on delete set null,
  routine_id    uuid references docket.routines (id) on delete cascade,  -- a routine, or...
  title         text check (title is null or char_length(trim(title)) between 1 and 200),  -- ...a task
  notes         text,
  remind_time   time,          -- "Remind me at" on each copy (Step 21)
  repeat        text not null check (repeat in ('daily', 'weekdays', 'weekly', 'biweekly', 'monthly')),
  repeat_days   smallint[],
  start_date    date not null default current_date,
  repeat_until  date,
  if_missed     text not null default 'carry' check (if_missed in ('fresh', 'carry')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table docket.repeat_rules add column if not exists remind_time time;  -- for a table made by an earlier run

-- The checks, added separately so re-running this file updates them
alter table docket.repeat_rules drop constraint if exists repeat_rules_what;
alter table docket.repeat_rules add constraint repeat_rules_what
  check ((routine_id is null) <> (title is null));                   -- a routine or a title, not both
alter table docket.repeat_rules drop constraint if exists repeat_rules_days;
alter table docket.repeat_rules add constraint repeat_rules_days check (
  repeat not in ('weekly', 'biweekly')
  or (cardinality(coalesce(repeat_days, '{}')) between 1 and 7
      and repeat_days <@ array[1,2,3,4,5,6,7]::smallint[])
);
alter table docket.repeat_rules drop constraint if exists repeat_rules_until;
alter table docket.repeat_rules add constraint repeat_rules_until
  check (repeat_until is null or repeat_until >= start_date);

-- A routine repeats on one schedule
create unique index if not exists repeat_rules_one_per_routine on docket.repeat_rules (routine_id)
  where routine_id is not null;
create index if not exists repeat_rules_by_area on docket.repeat_rules (area_id);

drop trigger if exists repeat_rules_set_updated_at on docket.repeat_rules;
create trigger repeat_rules_set_updated_at
  before update on docket.repeat_rules
  for each row execute function docket.set_updated_at();

-- Assigned to someone who shares the area (or no one)
create or replace function docket.check_rule_assignee()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.assigned_to is not null and not exists (
       select 1 from docket.areas a
        where a.id = new.area_id
          and (a.owner_id = new.assigned_to
               or exists (select 1 from docket.area_members m
                           where m.area_id = a.id and m.user_id = new.assigned_to))
     ) then
    raise exception 'Only someone who shares this area can be assigned.';
  end if;
  return new;
end;
$$;

drop trigger if exists repeat_rules_check_assignee on docket.repeat_rules;
create trigger repeat_rules_check_assignee
  before insert or update of assigned_to, area_id on docket.repeat_rules
  for each row execute function docket.check_rule_assignee();

-- Anyone who shares the area can see and change its repeats
alter table docket.repeat_rules enable row level security;

drop policy if exists "rules: read"   on docket.repeat_rules;
drop policy if exists "rules: add"    on docket.repeat_rules;
drop policy if exists "rules: change" on docket.repeat_rules;
drop policy if exists "rules: delete" on docket.repeat_rules;

create policy "rules: read" on docket.repeat_rules
  for select to authenticated using (docket.can_see_area(area_id));
create policy "rules: add" on docket.repeat_rules
  for insert to authenticated
  with check (created_by = (select auth.uid()) and docket.can_see_area(area_id));
create policy "rules: change" on docket.repeat_rules
  for update to authenticated
  using (docket.can_see_area(area_id)) with check (docket.can_see_area(area_id));
create policy "rules: delete" on docket.repeat_rules
  for delete to authenticated using (docket.can_see_area(area_id));

grant select, insert, update, delete on docket.repeat_rules to authenticated;
grant all on docket.repeat_rules to service_role;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'docket' and tablename = 'repeat_rules'
  ) then
    alter publication supabase_realtime add table docket.repeat_rules;
  end if;
end;
$$;


-- ---------------------------------------------------------------
-- Copies: ordinary tasks that remember their rule and date.
-- Stopping a repeat keeps the copies already made.
-- ---------------------------------------------------------------
alter table docket.tasks add column if not exists rule_id   uuid references docket.repeat_rules (id) on delete set null;
alter table docket.tasks add column if not exists rule_date date;
create unique index if not exists tasks_one_copy_per_rule_date on docket.tasks (rule_id, rule_date)
  where rule_id is not null;

-- A repeating copy for someone else doesn't send "Bee assigned you" every
-- day: only the first assignment of the repeat did (from the form).
create or replace function docket.notify_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.assigned_to is not null
     and new.assigned_to is distinct from coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid)
     and (tg_op = 'INSERT' or new.assigned_to is distinct from old.assigned_to)
     and new.status <> 'done'
     and new.dropped_at is null
     and not (tg_op = 'INSERT' and new.rule_id is not null)
  then
    begin
      perform net.http_post(
        url     := 'https://cqiwinquzfynelkmeywc.supabase.co/functions/v1/send-digest',
        headers := jsonb_build_object(
          'Content-Type',  'application/json',
          'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'docket_cron_secret')
        ),
        body    := jsonb_build_object('assigned_task', new.id, 'assigned_by', auth.uid()),
        timeout_milliseconds := 10000
      );
    exception when others then
      raise warning 'Assignment notification not sent: %', sqlerrm;
    end;
  end if;
  return new;
end;
$$;

-- Each person's "made today's copies" date, so the schedule runs once a day
alter table docket.user_settings add column if not exists last_repeats_on date;


-- ---------------------------------------------------------------
-- Make the copies due on a day, for the rules one person can see.
-- 1. Unfinished Start-fresh copies from earlier days are removed.
-- 2. Each rule due that day gets a copy, unless it has one already, or
--    it's Carry-over and an earlier copy is still open.
-- Returns how many copies it added. Running it again adds nothing.
-- ---------------------------------------------------------------
create or replace function docket.make_due_repeats(p_user uuid, p_day date)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r        record;
  v_task   uuid;
  v_made   integer := 0;
  v_rules  uuid[];
begin
  -- The rules in areas this person owns or has joined
  v_rules := array(
    select rr.id
      from docket.repeat_rules rr
      join docket.areas a on a.id = rr.area_id
     where a.owner_id = p_user
        or exists (select 1 from docket.area_members m where m.area_id = a.id and m.user_id = p_user)
  );

  -- 1. Start fresh: yesterday's unfinished copy goes
  delete from docket.tasks t
   using docket.repeat_rules rr
   where t.rule_id = rr.id
     and rr.id = any (v_rules)
     and rr.if_missed = 'fresh'
     and t.rule_date < p_day
     and t.status <> 'done'
     and t.dropped_at is null;

  -- 2. Today's copies
  for r in
    select rr.*, ro.name as routine_name, ro.steps as routine_steps
      from docket.repeat_rules rr
      left join docket.routines ro on ro.id = rr.routine_id
     where rr.id = any (v_rules)
       and docket.occurs_on(rr.repeat, rr.repeat_days, rr.start_date, rr.repeat_until, p_day)
       and not exists (select 1 from docket.tasks t where t.rule_id = rr.id and t.rule_date = p_day)
       and not (rr.if_missed = 'carry' and exists (
             select 1 from docket.tasks t
              where t.rule_id = rr.id and t.status <> 'done' and t.dropped_at is null))
  loop
    insert into docket.tasks (created_by, assigned_to, title, notes, scheduled_date, original_date,
                              rule_id, rule_date, remind_time)
    values (
      r.created_by,
      r.assigned_to,
      coalesce(r.routine_name, r.title),
      case
        when r.routine_id is not null then
          (select string_agg('- [ ] ' || trim(s), E'\n' order by n)
             from unnest(r.routine_steps) with ordinality as x(s, n))
        else nullif(trim(r.notes), '')
      end,
      p_day, p_day, r.id, p_day, r.remind_time
    )
    on conflict do nothing
    returning id into v_task;

    if v_task is not null then
      insert into docket.task_areas (task_id, area_id) values (v_task, r.area_id) on conflict do nothing;
      if r.routine_id is not null then
        update docket.routines set times_used = times_used + 1 where id = r.routine_id;
      end if;
      v_made := v_made + 1;
    end if;
  end loop;

  return v_made;
end;
$$;

revoke execute on function docket.make_due_repeats(uuid, date) from public, anon, authenticated;
grant execute on function docket.make_due_repeats(uuid, date) to service_role;

-- The app calls this when it opens (a backup to the schedule), with the
-- date where you are. Only today, give or take a day for time zones.
create or replace function docket.make_my_repeats(p_today date)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Please sign in again.';
  end if;
  if p_today not between current_date - 1 and current_date + 1 then
    raise exception 'That date is too far from today.';
  end if;
  return docket.make_due_repeats(auth.uid(), p_today);
end;
$$;

revoke execute on function docket.make_my_repeats(date) from public, anon;
grant execute on function docket.make_my_repeats(date) to authenticated;

-- The schedule: for everyone whose day has started and hasn't had its
-- copies made yet, make them. Runs every 15 minutes, so copies appear
-- shortly after midnight wherever you are, before the morning digest.
create or replace function docket.run_due_repeats(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  s       record;
  v_total integer := 0;
begin
  for s in
    update docket.user_settings us
       set last_repeats_on = (p_now at time zone us.timezone)::date
     where us.last_repeats_on is null
        or us.last_repeats_on < (p_now at time zone us.timezone)::date
    returning us.user_id, us.last_repeats_on as local_day
  loop
    v_total := v_total + docket.make_due_repeats(s.user_id, s.local_day);
  end loop;
  return v_total;
end;
$$;

revoke execute on function docket.run_due_repeats(timestamptz) from public, anon, authenticated;
grant execute on function docket.run_due_repeats(timestamptz) to service_role;

select cron.unschedule(jobid) from cron.job where jobname = 'docket-repeats';
select cron.schedule('docket-repeats', '*/15 * * * *', $job$ select docket.run_due_repeats(); $job$);

-- Check: should list the digest, reminders and repeats jobs, all active
select jobid, jobname, schedule, active from cron.job where jobname like 'docket-%' order by jobname;
