-- Daily Docket: sample data for testing (not for production)
-- Not sure which email? Run:  select id, email from auth.users;
-- 1. Replace you@example.com with the email you sign in to Pantry with.
-- 2. Run the whole file in the Supabase SQL Editor.
-- The SQL Editor runs as an admin, so we pass your user id in by hand.

-- Your four starter areas
select docket.seed_starter_areas(
  (select id from auth.users where lower(email) = lower('you@example.com'))
);

-- A few tasks, some carried over from earlier days
with me as (
  select id from auth.users where lower(email) = lower('you@example.com')
),
new_tasks as (
  insert into docket.tasks
    (created_by, title, notes, status, completed_at,
     scheduled_date, original_date, due_date)
  select me.id, v.title, v.notes, v.status, v.completed_at,
         v.scheduled, v.original, v.due
  from me, (values
    ('Send access review to client', 'Waiting on final numbers', 'todo', null::timestamptz,
       current_date - 3, current_date - 3, null::date),
    ('Book furnace inspection', 'Tenant prefers mornings', 'todo', null,
       current_date - 2, current_date - 2, current_date + 3),
    ('Call plumber about sink', null, 'todo', null,
       current_date - 1, current_date - 1, null),
    ('Fix failing Flow alerts', null, 'doing', null,
       current_date, current_date, current_date + 1),
    ('Draft Sunday announcements', null, 'todo', null,
       current_date, current_date, null),
    ('Buy printer ink', null, 'done', now(),
       current_date, current_date, null),
    ('Clean gutters', null, 'todo', null,
       current_date + 4, current_date + 4, null)
  ) as v(title, notes, status, completed_at, scheduled, original, due)
  returning id, title
)
insert into docket.task_areas (task_id, area_id)
select t.id, a.id
from new_tasks t
join (values
  ('Send access review to client', 'Work'),
  ('Book furnace inspection',      'Rentals'),
  ('Call plumber about sink',      'Home'),
  ('Fix failing Flow alerts',      'Work'),
  ('Draft Sunday announcements',   'Ministry'),
  ('Buy printer ink',              'Home'),
  ('Buy printer ink',              'Work'),
  ('Clean gutters',                'Home')
) as m(title, area) on m.title = t.title
join docket.areas a
  on a.name = m.area
 and a.owner_id = (select id from me);

-- Check: this is the Today query. Oldest carry-overs first.
select t.title,
       t.status,
       t.original_date,
       current_date - t.original_date as days_carried,
       string_agg(a.name, ', ' order by a.sort_order) as areas
from docket.tasks t
left join docket.task_areas ta on ta.task_id = t.id
left join docket.areas a       on a.id = ta.area_id
where t.status <> 'done'
  and t.dropped_at is null
  and t.scheduled_date <= current_date
group by t.id
order by t.original_date, t.created_at;
