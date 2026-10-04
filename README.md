# Daily Docket

A to-do app for work and home where unfinished tasks roll forward on their own. No rewriting lists every morning.

## Stack

- **Front end:** React with Vite and React Router, installed on the phone's home screen as a web app
- **Back end:** Supabase (Postgres, sign-in, realtime sync, scheduled jobs). Shares the Pantry project; all tables live in the `docket` schema.
- **Hosting:** Vercel

## Build phases

| Phase | What it adds |
| --- | --- |
| 1 — Today & tasks | Today list with carry-over, add/edit, quick capture, close the day, morning digest |
| 2 — Sharing, trips, week & reminders | Shared areas, trips, repeating tasks, week plan, task reminders |
| 3 — Routines | Saved checklists that add one task per step |
| 4 — Chat bot | Telegram/WhatsApp via n8n, OpenClaw agent version |

## Database setup

Run the files in `supabase/` in the Supabase SQL Editor, in number order.

1. `001_docket_core.sql` — the `docket` schema, areas, tasks, the task–area link table and row-level security
2. `002_realtime.sql` — turns on live sync for the docket tables
3. `003_save_task.sql` — saves a task and its areas in one transaction
4. `004_close_day.sql` — applies the Close the day choices in one transaction
5. `005_close_day_undo.sql` — adds restore, used by Undo and History
6. `006_reopen_day.sql` — records each close so the day can be reopened until midnight
7. `007_push.sql` — one row per device with notifications switched on
8. `008_reschedule.sql` — moves many tasks to new days at once (Shift plan and its Undo)
9. `009_digest.sql` — digest settings per person, and who is due a digest right now
10. `010_digest_schedule.sql` — runs the digest every 15 minutes (needs `CRON_SECRET`, see the file)
11. `011_manage_areas.sql` — delete an area safely (moving its tasks) and reorder areas
12. `012_share_areas.sql` — share an area by email; new security rules for shared areas
13. `013_assign.sql` — assign tasks in shared areas, and notify the assignee (redeploy `send-digest` too)
14. `014_events.sql` — trips and events, visible to everyone in the area
15. `015_calendar_feed.sql` — a private calendar link per person (deploy `calendar-feed` too)
16. `016_event_times.sql` — one-day and timed events (redeploy `calendar-feed` too)
17. `017_digest_retry.sql` — a digest that reaches no device is retried 15 minutes later (redeploy `send-digest` too)

`dev_sample_data.sql` loads test data for your own account. Don't run it in a shared or production setup.

After running `001`, add `docket` to **Exposed schemas** in the project's Data API settings so the app can reach it.

## User guide

The in-app guide is `src/pages/Help.jsx` (Settings → Help, or the "?" on Close the day and Shift plan). When a screen changes, update its section there too.

## Running locally

1. Copy `.env.example` to `.env.local` and fill in the Supabase URL and key (the same values Pantry uses).
2. `npm install`
3. `npm run dev`
4. `npm test` runs the unit tests (Vitest), e.g. the notes list logic in `src/lib/notes.test.js` the calendar feed in `src/lib/ics.test.js` and event labels in `src/lib/events.test.js`.

## Push notifications

1. `npx web-push generate-vapid-keys` prints a public and a private key.
2. Public key: `VITE_VAPID_PUBLIC_KEY` in `.env.local` and in Vercel.
3. Supabase **Edge Functions → Secrets**: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT` (`mailto:` plus your email).
4. Deploy `supabase/functions/send-test-push/index.ts` as an Edge Function named `send-test-push`. In the dashboard editor, set the name box before deploying: it sets the function's address, which can't be changed later. The URL column should end in `/send-test-push`.

Morning digest: deploy `supabase/functions/send-digest/index.ts` as `send-digest` (set the name before deploying), add the secret `CRON_SECRET`, then run `010_digest_schedule.sql`.

Calendar feed: deploy `supabase/functions/calendar-feed/index.ts` as `calendar-feed` (set the name before deploying). It's one file with no imports. Turn **Verify JWT** off, because calendar apps can't sign in; the token in each person's link is the lock.

On iPhone, notifications only work from the home-screen app.

## Deploying

Hosted on Vercel from the `main` branch; every push redeploys.

1. Vercel: **Add New → Project**, import the `daily-docket` repo. Vite is detected automatically.
2. Add the environment variables `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` (same values as `.env.local`), then deploy.
3. Custom domain: **Settings → Domains**, add `docket.preciousdoxa.com`, and add the CNAME record Vercel shows in Namecheap (host `docket`).
4. Supabase: **Authentication → URL Configuration**, add the new address under **Redirect URLs**. Leave the Site URL on Pantry's address, since both apps share the project.

`vercel.json` sends every path to `index.html`, so links like `/history` work on refresh.
