-- Daily Docket, step 11: morning digest settings
-- One row per person: their timezone and when they want the digest.
-- Safe to re-run.

create table if not exists docket.user_settings (
  user_id         uuid primary key default auth.uid()
                  references auth.users (id) on delete cascade,
  timezone        text not null default 'America/New_York',
  digest_on       boolean not null default true,
  digest_time     time not null default '07:30'
                  check (digest_time between '04:00' and '20:00'),
  digest_days     text not null default 'weekdays'
                  check (digest_days in ('weekdays', 'every')),
  last_digest_on  date,                      -- stops a second digest the same day
  updated_at      timestamptz not null default now()
);

-- Reject a timezone Postgres doesn't know ("now() at time zone" raises)
create or replace function docket.check_timezone()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform now() at time zone new.timezone;
  return new;
end;
$$;

drop trigger if exists user_settings_check_timezone on docket.user_settings;
create trigger user_settings_check_timezone
  before insert or update of timezone on docket.user_settings
  for each row execute function docket.check_timezone();

drop trigger if exists user_settings_set_updated_at on docket.user_settings;
create trigger user_settings_set_updated_at
  before update on docket.user_settings
  for each row execute function docket.set_updated_at();

alter table docket.user_settings enable row level security;

drop policy if exists "settings: read own"   on docket.user_settings;
drop policy if exists "settings: add own"    on docket.user_settings;
drop policy if exists "settings: change own" on docket.user_settings;

create policy "settings: read own" on docket.user_settings
  for select to authenticated
  using (user_id = (select auth.uid()));
create policy "settings: add own" on docket.user_settings
  for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "settings: change own" on docket.user_settings
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

grant select, insert, update on docket.user_settings to authenticated;
grant all on docket.user_settings to service_role;


-- Who is due a digest right now? Marks them as sent in the same statement,
-- so two overlapping runs can never send the same person two digests.
-- Due = digest on, it's a chosen day where they live, their time has come
-- (within the last 3 hours), nothing sent yet today, and at least one
-- device has notifications on.
-- Only the server (service_role) may call this.
create or replace function docket.claim_digests(p_now timestamptz default now())
returns table (user_id uuid, local_date date)
language sql
security definer
set search_path = ''
as $$
  update docket.user_settings s
     set last_digest_on = (p_now at time zone s.timezone)::date
   where s.digest_on
     and (p_now at time zone s.timezone)::time >= s.digest_time
     and (p_now at time zone s.timezone)::time <  s.digest_time + interval '3 hours'
     and (s.digest_days = 'every'
          or extract(isodow from (p_now at time zone s.timezone)) between 1 and 5)
     and (s.last_digest_on is null
          or s.last_digest_on < (p_now at time zone s.timezone)::date)
     and exists (select 1 from docket.push_subscriptions p where p.user_id = s.user_id)
  returning s.user_id, s.last_digest_on;
$$;

revoke execute on function docket.claim_digests(timestamptz) from public, anon, authenticated;
grant execute on function docket.claim_digests(timestamptz) to service_role;
