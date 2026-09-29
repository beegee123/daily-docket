-- Daily Docket, step 10: push notifications
-- One row per device that has said yes to notifications.
-- Safe to re-run.

create table if not exists docket.push_subscriptions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid()
                references auth.users (id) on delete cascade,
  endpoint      text not null unique,   -- the address the phone's push service gives us
  p256dh        text not null,          -- the phone's public key (for encryption)
  auth          text not null,          -- a shared secret (for encryption)
  device_name   text,
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz
);

create index if not exists push_subscriptions_by_user
  on docket.push_subscriptions (user_id);

alter table docket.push_subscriptions enable row level security;

drop policy if exists "push: read own"   on docket.push_subscriptions;
drop policy if exists "push: change own" on docket.push_subscriptions;
drop policy if exists "push: delete own" on docket.push_subscriptions;

create policy "push: read own" on docket.push_subscriptions
  for select to authenticated
  using (user_id = (select auth.uid()));
create policy "push: change own" on docket.push_subscriptions
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy "push: delete own" on docket.push_subscriptions
  for delete to authenticated
  using (user_id = (select auth.uid()));
-- No insert policy: new rows only arrive through the function below.

grant select, update, delete on docket.push_subscriptions to authenticated;
grant all on docket.push_subscriptions to service_role;


-- Save this device for the signed-in person.
-- A device belongs to whoever is signed in on it now: if someone else
-- used this phone before, their row for it is replaced. That needs to
-- see other people's rows, so this one function runs with the owner's
-- rights (security definer), and it only ever writes auth.uid().
create or replace function docket.save_push_subscription(
  p_endpoint    text,
  p_p256dh      text,
  p_auth        text,
  p_device_name text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Please sign in again.';
  end if;

  delete from docket.push_subscriptions
   where endpoint = p_endpoint
     and user_id <> auth.uid();

  insert into docket.push_subscriptions (user_id, endpoint, p256dh, auth, device_name)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, p_device_name)
  on conflict (endpoint) do update
    set p256dh      = excluded.p256dh,
        auth        = excluded.auth,
        device_name = excluded.device_name;
end;
$$;

revoke execute on function docket.save_push_subscription(text, text, text, text) from anon, public;
grant execute on function docket.save_push_subscription(text, text, text, text) to authenticated;
