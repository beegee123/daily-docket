-- Daily Docket: retry a morning digest that didn't arrive
-- claim_digests (009) marks a person as "sent today" before sending, so
-- two overlapping runs can never send twice. If the send then reaches no
-- device, send-digest calls this to undo the mark, and the next run
-- (15 minutes later) tries again, until the 3-hour window closes.
--
-- Run after 009. Safe to re-run. Redeploy send-digest afterwards.

create or replace function docket.release_digest(p_user uuid, p_date date)
returns void
language sql
security definer
set search_path = ''
as $$
  -- Only undo today's mark; leaves a later or earlier day alone
  update docket.user_settings
     set last_digest_on = p_date - 1
   where user_id = p_user
     and last_digest_on = p_date;
$$;

revoke execute on function docket.release_digest(uuid, date) from public, anon, authenticated;
grant execute on function docket.release_digest(uuid, date) to service_role;
