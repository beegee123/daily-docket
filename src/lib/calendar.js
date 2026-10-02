// Links for the calendar feed (step 16b). The feed itself is the
// calendar-feed Edge Function; these just build the addresses to it.

export const CALENDAR_FUNCTION = 'calendar-feed'

/** https://<project>.supabase.co/functions/v1/calendar-feed?token=... */
export function feedUrl(supabaseUrl, token) {
  return `${supabaseUrl.replace(/\/+$/, '')}/functions/v1/${CALENDAR_FUNCTION}?token=${token}`
}

/** The same link with webcal://, which tells phones "subscribe to this calendar". */
export const webcalUrl = (httpsUrl) => httpsUrl.replace(/^https?:\/\//, 'webcal://')

/** Opens Google Calendar's "add this calendar?" page. */
export const googleAddUrl = (httpsUrl) =>
  `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcalUrl(httpsUrl))}`
