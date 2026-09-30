// Dates are kept as 'YYYY-MM-DD' strings in the LOCAL timezone,
// the same shape Postgres uses for a `date` column.
// Strings in this shape sort and compare correctly as plain text.

const pad = (n) => String(n).padStart(2, '0')

/** Today's date (or any Date) as 'YYYY-MM-DD' in the user's own timezone. */
export function toLocalISODate(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** Local midnight today, as a full timestamp the database understands. */
export function startOfLocalDayISO(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).toISOString()
}

/** A Date object N days before today (same time of day). */
export function daysAgo(n) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d
}

/** 'Today', 'Yesterday', or 'Mon 28 Sep' for a 'YYYY-MM-DD' in the past. */
export function formatPastDay(iso, todayISO = toLocalISODate()) {
  const diff = daysBetween(iso, todayISO)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  const [y, m, d] = iso.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  const weekday = date.toLocaleDateString('en-US', { weekday: 'short' })
  const month = date.toLocaleDateString('en-US', { month: 'short' })
  return `${weekday} ${d} ${month}`
}

/** A date N days from today, e.g. daysFromToday(-3) for three days ago. */
export function daysFromToday(n) {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return toLocalISODate(d)
}

/** Whole days from one 'YYYY-MM-DD' to another. */
export function daysBetween(fromISO, toISO) {
  // Treat both as midnight UTC so daylight-saving shifts can't give 2.96 days
  const toUTC = (iso) => {
    const [y, m, d] = iso.split('-').map(Number)
    return Date.UTC(y, m - 1, d)
  }
  return Math.round((toUTC(toISO) - toUTC(fromISO)) / 86_400_000)
}

/** 'Tuesday, 29 Sep' for the page header. */
export function formatHeaderDate(date = new Date()) {
  const weekday = date.toLocaleDateString('en-US', { weekday: 'long' })
  const month = date.toLocaleDateString('en-US', { month: 'short' })
  return `${weekday}, ${date.getDate()} ${month}`
}

/** 'Wed' for a date within the next week, otherwise '2 Oct'. */
export function formatShortDate(iso, todayISO = toLocalISODate()) {
  const [y, m, d] = iso.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  const diff = daysBetween(todayISO, iso)
  if (diff === 0) return 'today'
  if (diff === 1) return 'tomorrow'
  if (diff > 1 && diff < 7) return date.toLocaleDateString('en-US', { weekday: 'short' })
  return `${d} ${date.toLocaleDateString('en-US', { month: 'short' })}`
}

/** 'YYYY-MM-DD' -> a local Date at midnight. */
export function fromISODate(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** Add (or subtract) whole days to a 'YYYY-MM-DD'. */
export function addDaysISO(iso, n) {
  const d = fromISODate(iso)
  d.setDate(d.getDate() + n)
  return toLocalISODate(d)
}

/** The Monday of the week containing this date. */
export function startOfWeekISO(iso = toLocalISODate()) {
  const d = fromISODate(iso)
  const shift = (d.getDay() + 6) % 7 // Monday = 0 ... Sunday = 6
  d.setDate(d.getDate() - shift)
  return toLocalISODate(d)
}

/** 'Thursday, 1 Oct' for a 'YYYY-MM-DD'. */
export function formatLongDay(iso) {
  return formatHeaderDate(fromISODate(iso))
}

/** { weekday: 'THU', day: 1, month: 'Oct' } for the week cards. */
export function dayParts(iso) {
  const d = fromISODate(iso)
  return {
    weekday: d.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase(),
    day: d.getDate(),
    month: d.toLocaleDateString('en-US', { month: 'short' }),
  }
}
