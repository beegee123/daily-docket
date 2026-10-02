-- Daily Docket, step 16b: calendar feed
-- A private link per person that Google Calendar (or Apple, or Outlook)
-- subscribes to. It lists the trips and events from every area that person
-- can see. One-way: edit in Daily Docket, the calendar app follows.
--
-- The link carries a long random token instead of a sign-in, because
-- calendar apps can't sign in. Anyone with the link can read the feed,
-- so "Reset link" swaps the token and the old link stops working.
--
-- Run after 014. Safe to re-run.

create table if not exists docket.calendar_feeds (
  user_id     uuid primary key default auth.uid()
              references auth.users (id) on delete cascade,
  -- 64 hex characters from two random UUIDs: far too many to guess
  token       text not null unique
              default replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
  created_at  timestamptz not null default now()
);

-- You can read your own row. Creating and resetting go through the two
-- functions below, so there are no insert/update/delete rules.
alter table docket.calendar_feeds enable row level security;

drop policy if exists "calendar_feeds: read own" on docket.calendar_feeds;
create policy "calendar_feeds: read own" on docket.calendar_feeds
  for select to authenticated
  using (user_id = (select auth.uid()));

grant select on docket.calendar_feeds to authenticated;
grant all on docket.calendar_feeds to service_role;


-- Your token: made the first time you ask, the same one after that
create or replace function docket.my_calendar_token()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text;
begin
  if auth.uid() is null then
    raise exception 'Sign in first.';
  end if;

  insert into docket.calendar_feeds (user_id) values (auth.uid())
  on conflict (user_id) do nothing;

  select token into v_token from docket.calendar_feeds where user_id = auth.uid();
  return v_token;
end;
$$;

-- A fresh token. Calendars using the old link stop getting updates.
create or replace function docket.reset_calendar_token()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
begin
  if auth.uid() is null then
    raise exception 'Sign in first.';
  end if;

  insert into docket.calendar_feeds (user_id, token) values (auth.uid(), v_token)
  on conflict (user_id) do update set token = excluded.token, created_at = now();

  return v_token;
end;
$$;

revoke execute on function docket.my_calendar_token() from public, anon;
revoke execute on function docket.reset_calendar_token() from public, anon;
grant execute on function docket.my_calendar_token() to authenticated;
grant execute on function docket.reset_calendar_token() to authenticated;


-- What goes in one person's feed: events in every area they own or share,
-- from p_from onwards. Only the calendar-feed Edge Function calls this
-- (with the server key), after it has turned the token into a person.
-- The person isn't signed in there, so it takes their id instead of
-- auth.uid(); that's why ordinary users can't call it.
drop function if exists docket.feed_events(uuid, date);
create function docket.feed_events(p_user uuid, p_from date)
returns table (
  id           uuid,
  title        text,
  start_date   date,
  end_date     date,
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
  select e.id, e.title, e.start_date, e.end_date, e.notes, e.updated_at,
         a.name, e.person_id, u.email::text
  from docket.events e
  join docket.areas a on a.id = e.area_id
  left join auth.users u on u.id = e.person_id
  where e.end_date >= p_from
    and (a.owner_id = p_user
         or exists (select 1 from docket.area_members m
                    where m.area_id = a.id and m.user_id = p_user))
  order by e.start_date, e.title
  limit 1000;
$$;

revoke execute on function docket.feed_events(uuid, date) from public, anon, authenticated;
grant execute on function docket.feed_events(uuid, date) to service_role;
