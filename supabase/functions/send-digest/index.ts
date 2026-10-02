// Supabase Edge Function: send-digest
// Sends the morning digest: "5 on your docket today · 2 carried over".
//
// Two ways in:
//  1. The schedule (every 15 min, see 010_digest_schedule.sql). It sends the
//     header x-cron-secret. The function asks the database who is due right
//     now and sends each of them their digest.
//  2. A signed-in person tapping "Send today's digest now" in Settings. Only
//     their own digest is sent, whatever the time, for testing.
//  3. The database, when a task is assigned to someone (013_assign.sql). It
//     sends x-cron-secret plus { assigned_task, assigned_by } and the
//     assignee gets "Bee assigned you: Take out bins".
//
// If a digest reaches none of a person's devices, release_digest
// (017_digest_retry.sql) clears "sent today" so the next run retries.
//
// Secrets it needs (Edge Functions -> Secrets):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT  (already there for send-test-push)
//   CRON_SECRET                                        (new)
// SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are provided
// automatically.

import webpush from 'npm:web-push@3.6.7'
import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-retry-count, traceparent, tracestate, baggage',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

// Today's date where the person lives, as 'YYYY-MM-DD'
function localDate(timeZone: string, now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

type Result = { sent: number; removed: number; failed: number; skipped?: string }

// The server client, pointed at the docket schema
const makeAdmin = (url: string, key: string) =>
  createClient(url, key, { db: { schema: 'docket' }, auth: { persistSession: false } })
type Admin = ReturnType<typeof makeAdmin>

/** Build one person's digest and send it to all their devices. */
async function sendDigest(admin: Admin, userId: string, todayISO: string): Promise<Result> {
  // The server key skips row-level security, so every query names the person
  const { data: tasks, error } = await admin
    .from('tasks')
    .select('title, original_date')
    // My job: assigned to me, or unassigned and added by me
    .or(`assigned_to.eq.${userId},and(assigned_to.is.null,created_by.eq.${userId})`)
    .neq('status', 'done')
    .is('dropped_at', null)
    .lte('scheduled_date', todayISO)
    .order('original_date')
    .order('created_at')
  if (error) throw error

  // Nothing on the docket: no notification. An empty nudge is just noise.
  if (!tasks.length) return { sent: 0, removed: 0, failed: 0, skipped: 'nothing on the docket' }

  const carried = tasks.filter((t) => t.original_date < todayISO).length
  const parts = [`${tasks.length} on your docket today`]
  if (carried) parts.push(`${carried} carried over`)
  const first = tasks[0].title.length > 60 ? tasks[0].title.slice(0, 57) + '…' : tasks[0].title

  const payload = JSON.stringify({
    title: 'Good morning',
    body: `${parts.join(' · ')}\nFirst up: ${first}`,
    url: '/',
    tag: 'docket-digest', // a newer digest replaces an older one
  })

  return await sendToUser(admin, userId, payload)
}

/** Push one message to every device a person has switched on. */
async function sendToUser(admin: Admin, userId: string, payload: string): Promise<Result> {
  const { data: devices, error: devError } = await admin
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('user_id', userId)
  if (devError) throw devError

  const result: Result = { sent: 0, removed: 0, failed: 0 }
  for (const d of devices ?? []) {
    try {
      await webpush.sendNotification({ endpoint: d.endpoint, keys: { p256dh: d.p256dh, auth: d.auth } }, payload, {
        TTL: 4 * 60 * 60, // a phone that's off can still get it within 4 hours
      })
      result.sent++
      await admin.from('push_subscriptions').update({ last_used_at: new Date().toISOString() }).eq('id', d.id)
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode
      if (status === 404 || status === 410) {
        await admin.from('push_subscriptions').delete().eq('id', d.id)
        result.removed++
      } else {
        console.error('Digest push failed', status, (e as Error).message)
        result.failed++
      }
    }
  }
  return result
}

/** "Bee assigned you: Take out bins" to the person a task was assigned to. */
async function sendAssignment(admin: Admin, taskId: string, assignedBy: string | null): Promise<Result> {
  const { data: task, error } = await admin
    .from('tasks')
    .select('id, title, assigned_to, status, dropped_at')
    .eq('id', taskId)
    .maybeSingle()
  if (error) throw error
  if (!task?.assigned_to || task.status === 'done' || task.dropped_at) {
    return { sent: 0, removed: 0, failed: 0, skipped: 'nothing to tell' }
  }

  let who = 'Someone'
  if (assignedBy) {
    const { data } = await admin.auth.admin.getUserById(assignedBy)
    const local = data?.user?.email?.split('@')[0]
    if (local) who = local.charAt(0).toUpperCase() + local.slice(1)
  }
  const title = task.title.length > 80 ? task.title.slice(0, 77) + '…' : task.title

  const payload = JSON.stringify({
    title: 'New task for you',
    body: `${who} assigned you: ${title}`,
    url: `/task/${task.id}`,
    tag: `docket-assigned-${task.id}`,
  })
  return await sendToUser(admin, task.assigned_to, payload)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: cors })

  const url = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const publicKey = Deno.env.get('VAPID_PUBLIC_KEY')
  const privateKey = Deno.env.get('VAPID_PRIVATE_KEY')
  const subject = Deno.env.get('VAPID_SUBJECT')
  if (!serviceKey) return json({ error: 'SUPABASE_SERVICE_ROLE_KEY is not available to this function.' }, 500)
  if (!publicKey || !privateKey || !subject) return json({ error: 'Push keys are not set up yet (VAPID secrets missing).' }, 500)
  webpush.setVapidDetails(subject, publicKey, privateKey)

  const admin = makeAdmin(url, serviceKey)

  // --- 1. The schedule ---
  const cronSecret = Deno.env.get('CRON_SECRET')
  const given = req.headers.get('x-cron-secret')
  if (given !== null) {
    if (!cronSecret || given !== cronSecret) return json({ error: 'Not allowed.' }, 401)

    // From the database: a task was just assigned to someone
    const body = await req.json().catch(() => ({}))
    if (body?.assigned_task) {
      try {
        return json(await sendAssignment(admin, String(body.assigned_task), body.assigned_by ?? null))
      } catch (e) {
        console.error('Assignment push failed', (e as Error).message)
        return json({ error: (e as Error).message }, 500)
      }
    }

    const { data: due, error } = await admin.rpc('claim_digests')
    if (error) {
      console.error('claim_digests failed', error.message)
      return json({ error: error.message }, 500)
    }

    const totals = { people: due?.length ?? 0, sent: 0, removed: 0, failed: 0, skipped: 0, retrying: 0 }
    for (const row of due ?? []) {
      let delivered = false
      try {
        const r = await sendDigest(admin, row.user_id, row.local_date)
        totals.sent += r.sent
        totals.removed += r.removed
        totals.failed += r.failed
        if (r.skipped) totals.skipped++
        // Nothing to say counts as done; otherwise at least one device must have got it
        delivered = Boolean(r.skipped) || r.sent > 0
      } catch (e) {
        console.error('Digest failed for one person', (e as Error).message)
        totals.failed++
      }
      if (!delivered) {
        // Undo "sent today" so the next run (15 minutes later) tries again
        const { error: releaseError } = await admin.rpc('release_digest', {
          p_user: row.user_id,
          p_date: row.local_date,
        })
        if (releaseError) console.error('release_digest failed', releaseError.message)
        else totals.retrying++
      }
    }
    if (totals.people) console.info('Digest run', JSON.stringify(totals))
    return json(totals)
  }

  // --- 2. A signed-in person testing from Settings ---
  const asUser = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  })
  const { data: userData } = await asUser.auth.getUser()
  if (!userData?.user) return json({ error: 'Please sign in again.' }, 401)

  const { data: settings } = await admin
    .from('user_settings')
    .select('timezone')
    .eq('user_id', userData.user.id)
    .maybeSingle()
  const today = localDate(settings?.timezone ?? 'America/New_York')

  try {
    return json(await sendDigest(admin, userData.user.id, today))
  } catch (e) {
    return json({ error: (e as Error).message }, 500)
  }
})
