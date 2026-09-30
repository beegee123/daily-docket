// Supabase Edge Function: send-test-push
// Sends a test notification to every device the signed-in person has
// turned notifications on for. Removes devices that no longer accept pushes.
//
// Secrets it needs (Supabase dashboard -> Edge Functions -> Secrets):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:you@...)
// SUPABASE_URL and SUPABASE_ANON_KEY are provided automatically.

import webpush from 'npm:web-push@3.6.7'
import { createClient } from 'npm:@supabase/supabase-js@2'

// The browser checks these before sending the real request ("preflight").
// This is the full list of headers the Supabase library can send; if one
// is missing here, the browser refuses and the app sees
// "Failed to send a request to the Edge Function".
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-retry-count, traceparent, tracestate, baggage',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: cors })

  // Act AS the caller: their sign-in token rides along, so row-level
  // security limits this function to their own devices.
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    db: { schema: 'docket' },
  })

  const { data: userData } = await supabase.auth.getUser()
  if (!userData?.user) return json({ error: 'Please sign in again.' }, 401)

  const publicKey = Deno.env.get('VAPID_PUBLIC_KEY')
  const privateKey = Deno.env.get('VAPID_PRIVATE_KEY')
  const subject = Deno.env.get('VAPID_SUBJECT')
  if (!publicKey || !privateKey || !subject) {
    return json({ error: 'Push keys are not set up yet (VAPID secrets missing).' }, 500)
  }
  webpush.setVapidDetails(subject, publicKey, privateKey)

  const { data: devices, error } = await supabase
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
  if (error) return json({ error: error.message }, 500)
  if (!devices?.length) return json({ sent: 0, removed: 0, failed: 0, note: 'No devices have notifications on.' })

  const payload = JSON.stringify({
    title: 'Daily Docket',
    body: 'Test notification: push is working on this device.',
    url: '/',
    tag: 'docket-test',
  })

  let sent = 0
  let removed = 0
  let failed = 0

  for (const d of devices) {
    try {
      await webpush.sendNotification({ endpoint: d.endpoint, keys: { p256dh: d.p256dh, auth: d.auth } }, payload)
      sent++
      await supabase.from('push_subscriptions').update({ last_used_at: new Date().toISOString() }).eq('id', d.id)
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode
      // 404 / 410: the device unsubscribed or the app was removed. Tidy up.
      if (status === 404 || status === 410) {
        await supabase.from('push_subscriptions').delete().eq('id', d.id)
        removed++
      } else {
        console.error('Push failed', status, (e as Error).message)
        failed++
      }
    }
  }

  return json({ sent, removed, failed })
})
