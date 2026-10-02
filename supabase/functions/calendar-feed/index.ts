// Supabase Edge Function: calendar-feed
// The private calendar link: .../functions/v1/calendar-feed?token=...
// Google Calendar (or Apple, or Outlook) fetches it every so often and
// shows the trips and events from every area that person can see.
//
// Deploy with "Verify JWT" OFF: calendar apps can't sign in. The token in
// the link is the lock (015_calendar_feed.sql), and "Reset link" in
// Settings changes it.
//
// One file, no imports, so the dashboard editor needs nothing else, and
// the app's tests (npm test -> src/lib/ics.test.js) can load the calendar
// builder below straight from here.
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically.

// ---------------------------------------------------------------
// Part 1: turning events into an iCalendar (.ics) file, the plain-text
// format Google Calendar, Apple Calendar and Outlook all read.
// ---------------------------------------------------------------

export type FeedEvent = {
  id: string
  title: string
  start_date: string // 'YYYY-MM-DD'
  end_date: string // 'YYYY-MM-DD', the last day (inclusive)
  start_time: string | null // '14:00:00'; null = all day
  end_time: string | null // optional
  time_zone: string // where the time was entered, e.g. 'America/New_York'
  notes: string | null
  updated_at: string // ISO timestamp
  area_name: string
  person_id: string | null // who's away; null = a plain event
  person_email: string | null
}

const CRLF = '\r\n'
const UID_DOMAIN = 'docket.preciousdoxa.com'

/** 'husband.name@example.com' -> 'Husband.name', the same short name the app shows. */
export function shortName(email: string | null): string {
  if (!email) return 'Someone'
  const local = email.split('@')[0]
  return local.charAt(0).toUpperCase() + local.slice(1)
}

/** What the calendar shows: "You're away · Chicago", "Husband away · Chicago" or "PD1 exam". */
export function summaryFor(event: FeedEvent, viewerId: string): string {
  if (!event.person_id) return event.title
  const who = event.person_id === viewerId ? "You're away" : `${shortName(event.person_email)} away`
  return `${who} · ${event.title}`
}

/** '2026-10-05' -> '20261005' */
const icsDate = (iso: string) => iso.replaceAll('-', '')

/**
 * The day after a date. All-day events in .ics end on the morning AFTER
 * the last day, so a trip back on Thursday must say Friday, or calendars
 * show it a day short.
 */
export function nextDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

/** A timestamp in .ics form: '20261002T181500Z' (always UTC). */
export function icsStamp(isoTimestamp: string): string {
  return new Date(isoTimestamp).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

/**
 * A wall-clock time in a time zone -> the same moment in UTC, as .ics text.
 * '2026-11-05', '14:00:00', 'America/New_York' -> '20261105T190000Z'.
 * Works it out by asking what the clock in that zone reads at a guess,
 * then correcting by the difference (twice, so daylight-saving changes
 * that day come out right).
 */
export function zonedToUtc(dateISO: string, time: string, timeZone: string): string {
  return icsStamp(new Date(zonedToMs(dateISO, time, timeZone)).toISOString())
}

function zonedToMs(dateISO: string, time: string, timeZone: string): number {
  const [y, mo, d] = dateISO.split('-').map(Number)
  const [h, mi] = time.split(':').map(Number)
  const wanted = Date.UTC(y, mo - 1, d, h, mi)
  const offsetAt = (ms: number) => {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-US', {
        timeZone,
        hourCycle: 'h23',
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
      })
        .formatToParts(new Date(ms))
        .map((p) => [p.type, Number(p.value)]),
    )
    return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute) - ms
  }
  let ms = wanted - offsetAt(wanted)
  ms = wanted - offsetAt(ms)
  return ms
}

/** When a timed event starts and ends, in UTC. No end time = one hour. */
export function timedRange(event: FeedEvent): { start: string; end: string } {
  const start = zonedToUtc(event.start_date, event.start_time!, event.time_zone)
  if (event.end_time) return { start, end: zonedToUtc(event.end_date, event.end_time, event.time_zone) }
  if (event.end_date !== event.start_date) {
    // Runs over several days with no end time: until the end of the last day
    return { start, end: zonedToUtc(nextDay(event.end_date), '00:00', event.time_zone) }
  }
  const oneHourLater = zonedToMs(event.start_date, event.start_time!, event.time_zone) + 3_600_000
  return { start, end: icsStamp(new Date(oneHourLater).toISOString()) }
}

/** Text values must escape backslashes, semicolons, commas and line breaks. */
export function escapeText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n')
}

/**
 * Lines may be at most 75 bytes. Longer ones continue on the next line,
 * which starts with a space. Counts bytes, not letters, so an emoji or
 * accented letter is never split in half.
 */
export function foldLine(line: string): string {
  const encoder = new TextEncoder()
  const parts: string[] = []
  let current = ''
  let bytes = 0
  for (const ch of line) {
    const size = encoder.encode(ch).length
    if (bytes + size > 75) {
      parts.push(current)
      current = ' ' // the leading space counts towards the next line's 75
      bytes = 1
    }
    current += ch
    bytes += size
  }
  parts.push(current)
  return parts.join(CRLF)
}

/** One event as a VEVENT block. */
export function eventLines(event: FeedEvent, viewerId: string): string[] {
  const description = [event.notes?.trim(), `Area: ${event.area_name}`].filter(Boolean).join('\n\n')
  const stamp = icsStamp(event.updated_at)
  // Trips are always whole days, even if a time slipped in
  const timed = Boolean(event.start_time) && !event.person_id
  const when = timed
    ? (({ start, end }) => [`DTSTART:${start}`, `DTEND:${end}`])(timedRange(event))
    : [`DTSTART;VALUE=DATE:${icsDate(event.start_date)}`, `DTEND;VALUE=DATE:${icsDate(nextDay(event.end_date))}`]
  return [
    'BEGIN:VEVENT',
    `UID:${event.id}@${UID_DOMAIN}`,
    `DTSTAMP:${stamp}`,
    `LAST-MODIFIED:${stamp}`,
    ...when,
    `SUMMARY:${escapeText(summaryFor(event, viewerId))}`,
    `DESCRIPTION:${escapeText(description)}`,
    // A timed event shows as busy; trips and all-day events show as free,
    // so they don't block the whole day
    timed ? 'TRANSP:OPAQUE' : 'TRANSP:TRANSPARENT',
    'END:VEVENT',
  ]
}

/** The whole calendar file for one person. */
export function buildCalendar(events: FeedEvent[], viewerId: string): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Daily Docket//Calendar feed//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Daily Docket',
    'X-WR-CALDESC:Trips and events from Daily Docket',
    // A hint to check hourly. Apple and Outlook listen; Google picks its own pace.
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
    ...events.flatMap((e) => eventLines(e, viewerId)),
    'END:VCALENDAR',
  ]
  return lines.map(foldLine).join(CRLF) + CRLF
}

// ---------------------------------------------------------------
// Part 2: the web address calendar apps call.
// ---------------------------------------------------------------

// How far back the feed reaches. Older trips stay in the app's history.
const DAYS_BACK = 60

const text = (body: string, status: number) =>
  new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })

/**
 * Ask the database directly over its REST API (the same thing supabase-js
 * does underneath). The server key skips row-level security, so
 * feed_events does the "which areas can this person see" check itself.
 * The *-Profile headers point at the docket schema.
 */
async function db(path: string, init: RequestInit = {}) {
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const res = await fetch(`${Deno.env.get('SUPABASE_URL')}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Accept-Profile': 'docket',
      'Content-Profile': 'docket',
      'Content-Type': 'application/json',
    },
  })
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`)
  return res.json()
}

async function handle(req: Request): Promise<Response> {
  if (req.method !== 'GET' && req.method !== 'HEAD') return text('Use GET.', 405)

  const token = new URL(req.url).searchParams.get('token') ?? ''
  if (!/^[0-9a-f]{64}$/.test(token)) return text('Calendar link not found.', 404)

  try {
    const feeds: { user_id: string }[] = await db(`calendar_feeds?select=user_id&token=eq.${token}`)
    if (!feeds.length) return text('This calendar link was reset or never existed. Get the new one from Settings.', 404)
    const userId = feeds[0].user_id

    const from = new Date(Date.now() - DAYS_BACK * 86_400_000).toISOString().slice(0, 10)
    const events: FeedEvent[] = await db('rpc/feed_events', {
      method: 'POST',
      body: JSON.stringify({ p_user: userId, p_from: from }),
    })

    return new Response(req.method === 'HEAD' ? null : buildCalendar(events, userId), {
      status: 200,
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': 'inline; filename="daily-docket.ics"',
        'Cache-Control': 'no-cache',
      },
    })
  } catch (e) {
    console.error(e)
    return text('Something went wrong. Try again later.', 500)
  }
}

// Only start the server inside Supabase (Deno). The tests load this file
// in Node just for Part 1, where there is no Deno and nothing to serve.
if (typeof Deno !== 'undefined') Deno.serve(handle)
