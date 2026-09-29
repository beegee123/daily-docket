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

`dev_sample_data.sql` loads test data for your own account. Don't run it in a shared or production setup.

After running `001`, add `docket` to **Exposed schemas** in the project's Data API settings so the app can reach it.

## Running locally

1. Copy `.env.example` to `.env.local` and fill in the Supabase URL and key (the same values Pantry uses).
2. `npm install`
3. `npm run dev`

## Deploying

Hosted on Vercel from the `main` branch; every push redeploys.

1. Vercel: **Add New → Project**, import the `daily-docket` repo. Vite is detected automatically.
2. Add the environment variables `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` (same values as `.env.local`), then deploy.
3. Custom domain: **Settings → Domains**, add `docket.preciousdoxa.com`, and add the CNAME record Vercel shows in Namecheap (host `docket`).
4. Supabase: **Authentication → URL Configuration**, add the new address under **Redirect URLs**. Leave the Site URL on Pantry's address, since both apps share the project.

`vercel.json` sends every path to `index.html`, so links like `/history` work on refresh.
