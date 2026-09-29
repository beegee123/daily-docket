-- Daily Docket, step 9: reopen the day
-- Every Close the day is recorded with the information needed to undo it,
-- so the day can be reopened any time until midnight (the app only offers
-- today's closes). Closing twice and reopening twice unwinds them in order.
-- Safe to re-run.

create table if not exists docket.day_closures (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid()
               references auth.users (id) on delete cascade,
  closed_on    date not null,              -- the user's local date
  closed_at    timestamptz not null default now(),
  undo_items   jsonb not null,             -- where each task was before
  reopened_at  timestamptz
);

create index if not exists day_closures_by_user_day
  on docket.day_closures (user_id, closed_on);

alter table docket.day_closures enable row level security;

drop policy if exists "day_closures: read own"   on docket.day_closures;
drop policy if exists "day_closures: add own"    on docket.day_closures;
drop policy if exists "day_closures: change own" on docket.day_closures;

create policy "day_closures: read own" on docket.day_closures
  for select to authenticated
  using (user_id = (select auth.uid()));
create policy "day_closures: add own" on docket.day_closures
  for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "day_closures: change own" on docket.day_closures
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

grant select, insert, update on docket.day_closures to authenticated;
grant all on docket.day_closures to service_role;


-- Close the day AND keep a record, in one transaction
create or replace function docket.close_day_with_record(
  p_items      jsonb,
  p_closed_on  date,
  p_undo_items jsonb
)
returns table (moved int, dropped int, closure_id uuid)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_moved   int;
  v_dropped int;
  v_id      uuid;
begin
  select c.moved, c.dropped into v_moved, v_dropped
  from docket.close_day(p_items) as c;

  insert into docket.day_closures (closed_on, undo_items)
  values (p_closed_on, coalesce(p_undo_items, '[]'::jsonb))
  returning id into v_id;

  return query select v_moved, v_dropped, v_id;
end;
$$;


-- Reopen: put every task back where it was before that close
create or replace function docket.reopen_day(p_closure_id uuid)
returns int
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_undo  jsonb;
  v_moved int;
begin
  select undo_items into v_undo
  from docket.day_closures
  where id = p_closure_id
    and reopened_at is null
  for update;

  if v_undo is null then
    raise exception 'That day is already reopened.';
  end if;

  select c.moved into v_moved from docket.close_day(v_undo) as c;

  update docket.day_closures
     set reopened_at = now()
   where id = p_closure_id;

  return v_moved;
end;
$$;

grant execute on function docket.close_day_with_record(jsonb, date, jsonb) to authenticated;
grant execute on function docket.reopen_day(uuid) to authenticated;
revoke execute on function docket.close_day_with_record(jsonb, date, jsonb) from anon, public;
revoke execute on function docket.reopen_day(uuid) from anon, public;


-- Live sync: a close or reopen on one device shows on the others
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'docket' and tablename = 'day_closures'
  ) then
    alter publication supabase_realtime add table docket.day_closures;
  end if;
end;
$$;
