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

`dev_sample_data.sql` loads test data for your own account. Don't run it in a shared or production setup.

After running `001`, add `docket` to **Exposed schemas** in the project's Data API settings so the app can reach it.
