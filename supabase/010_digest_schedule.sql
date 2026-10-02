-- Daily Docket, step 11: run the morning digest every 15 minutes
--
-- Before running this file:
-- 1. Make a secret by running this line on its own and copying the result:
--      select replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '') as cron_secret;
-- 2. Add it in Edge Functions -> Secrets as  CRON_SECRET
-- 3. Paste the same value below where it says PASTE_SECRET_HERE, then run
--    this whole file.
--
-- The secret is kept in Supabase Vault (encrypted), not in the job text.
-- Safe to re-run: it replaces the secret and the job.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

do $$
declare
  v_secret text := 'PASTE_SECRET_HERE';
  v_id uuid;
begin
  if v_secret = 'PASTE_SECRET_HERE' or length(v_secret) < 32 then
    raise exception 'Paste your CRON_SECRET into this file first (step 3 at the top).';
  end if;

  select id into v_id from vault.secrets where name = 'docket_cron_secret';
  if v_id is null then
    perform vault.create_secret(v_secret, 'docket_cron_secret', 'Shared secret for the send-digest Edge Function');
  else
    perform vault.update_secret(v_id, v_secret);
  end if;
end;
$$;

-- Replace any earlier version of the job
select cron.unschedule(jobid) from cron.job where jobname = 'docket-morning-digest';

select cron.schedule(
  'docket-morning-digest',
  '*/15 * * * *',
  $job$
  select net.http_post(
    url     := 'https://cqiwinquzfynelkmeywc.supabase.co/functions/v1/send-digest',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'docket_cron_secret')
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 15000
  );
  $job$
);

-- Check: should list one active job
select jobid, jobname, schedule, active from cron.job where jobname = 'docket-morning-digest';
