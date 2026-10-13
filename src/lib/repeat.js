import { addDaysISO, daysBetween, formatDayMonth, fromISODate, startOfWeekISO } from './dates.js'

// Repeating events (step 21b). Only the pattern is stored; these work out
// the dates. The same rules live in SQL (docket.occurs_on, for reminders)
// and in the calendar feed (as an RRULE), so all three agree.
//
//   repeat       null | 'daily' (tasks and routines only) | 'weekdays' | 'weekly' | 'biweekly' | 'monthly'
//   repeatDays   ISO weekdays for weekly / every 2 weeks: 1 = Mon ... 7 = Sun
//   repeatUntil  last possible day, or null
//   skips        dates left out ("Not this time")

export const REPEAT_CHOICES = [
  [null, 'Never'],
  ['weekdays', 'Every weekday'],
  ['weekly', 'Every week'],
  ['biweekly', 'Every 2 weeks'],
  ['monthly', 'Every month'],
]

/** Tasks and routines can also repeat every day (meetings can't). */
export const TASK_REPEAT_CHOICES = [REPEAT_CHOICES[0], ['daily', 'Every day'], ...REPEAT_CHOICES.slice(1)]

/** What happens to a copy that isn't done (repeating tasks and routines). */
export const IF_MISSED_CHOICES = [
  ['fresh', 'Start fresh', 'Not done by the end of the day? It goes, and tomorrow starts clean.'],
  ['carry', 'Carry it over', 'Stays on your docket until done; the next one waits until then.'],
]

export const WEEKDAYS = [
  [1, 'Mon', 'Monday'],
  [2, 'Tue', 'Tuesday'],
  [3, 'Wed', 'Wednesday'],
  [4, 'Thu', 'Thursday'],
  [5, 'Fri', 'Friday'],
  [6, 'Sat', 'Saturday'],
  [7, 'Sun', 'Sunday'],
]

/** ISO weekday of a date: Monday 1 ... Sunday 7. */
export function isoWeekday(iso) {
  return fromISODate(iso).getDay() || 7
}

export const isRepeating = (ev) => Boolean(ev?.repeat)

/** Does the pattern fall on this day? (Ignores skips.) */
export function patternOn(ev, iso) {
  if (iso < ev.startDate) return false
  if (ev.repeatUntil && iso > ev.repeatUntil) return false
  const dow = isoWeekday(iso)
  switch (ev.repeat) {
    case 'daily':
      return true
    case 'weekdays':
      return dow <= 5
    case 'weekly':
      return (ev.repeatDays ?? []).includes(dow)
    case 'biweekly': {
      if (!(ev.repeatDays ?? []).includes(dow)) return false
      const weeks = daysBetween(startOfWeekISO(ev.startDate), startOfWeekISO(iso)) / 7
      return weeks % 2 === 0
    }
    case 'monthly':
      return Number(iso.slice(8)) === Number(ev.startDate.slice(8))
    default:
      return iso === ev.startDate
  }
}

/** Does it happen on this day, skips included? */
export const occursOn = (ev, iso) => patternOn(ev, iso) && !(ev.skips ?? []).includes(iso)

/**
 * One copy per date between from and to (inclusive), each looking like a
 * plain one-day event on that date. `occurrence` is the date; `seriesStart`
 * keeps the real first day. A plain event comes back as it is.
 */
export function expandEvent(ev, fromISO, toISO) {
  if (!isRepeating(ev)) return [{ ...ev, occurrence: ev.startDate }]
  const out = []
  let day = fromISO > ev.startDate ? fromISO : ev.startDate
  const last = ev.repeatUntil && ev.repeatUntil < toISO ? ev.repeatUntil : toISO
  while (day <= last) {
    if (occursOn(ev, day)) out.push({ ...ev, startDate: day, endDate: day, occurrence: day, seriesStart: ev.startDate })
    day = addDaysISO(day, 1)
  }
  return out
}

/** Every event's dates in the range, sorted by date then time. */
export function expandAll(events, fromISO, toISO) {
  return events
    .flatMap((ev) => expandEvent(ev, fromISO, toISO))
    .sort(
      (a, b) =>
        a.startDate.localeCompare(b.startDate) ||
        (a.startTime ?? '').localeCompare(b.startTime ?? '') ||
        a.title.localeCompare(b.title),
    )
}

/** The next date it happens on or after a day, or null (looks up to 400 days ahead). */
export function nextOccurrence(ev, fromISO) {
  if (!isRepeating(ev)) return ev.endDate >= fromISO ? ev.startDate : null
  let day = fromISO > ev.startDate ? fromISO : ev.startDate
  for (let i = 0; i < 400; i++, day = addDaysISO(day, 1)) {
    if (ev.repeatUntil && day > ev.repeatUntil) return null
    if (occursOn(ev, day)) return day
  }
  return null
}

const ordinal = (n) => {
  const tens = n % 100
  if (tens >= 11 && tens <= 13) return `${n}th`
  return `${n}${{ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th'}`
}

/** "Mon", "Mon and Thu", "Mon, Wed and Fri" (long names when there's one). */
function dayList(days) {
  const sorted = [...days].sort()
  if (sorted.length === 1) return WEEKDAYS[sorted[0] - 1][2]
  const short = sorted.map((d) => WEEKDAYS[d - 1][1])
  return `${short.slice(0, -1).join(', ')} and ${short.at(-1)}`
}

/** "Every Monday", "Every 2 weeks on Mon and Thu", "Every month on the 13th · until 18 Dec". */
export function repeatSummary(ev) {
  if (!isRepeating(ev)) return ''
  const base = {
    daily: 'Every day',
    weekdays: 'Every weekday',
    weekly: `Every ${dayList(ev.repeatDays ?? [])}`,
    biweekly: `Every 2 weeks on ${dayList(ev.repeatDays ?? [])}`,
    monthly: `Every month on the ${ordinal(Number(ev.startDate.slice(8)))}`,
  }[ev.repeat]
  return ev.repeatUntil ? `${base} · until ${formatDayMonth(ev.repeatUntil)}` : base
}

/** The days to light up when "Every week" is first picked: the start date's weekday. */
export const defaultDays = (startISO) => [isoWeekday(startISO)]

/** Instance key for attended ticks: one per event per date. */
export const occurrenceKey = (ev) => `${ev.id}@${ev.occurrence ?? ev.startDate}`

/** Where a date of an event opens: a series opens on that date. */
export const eventLink = (ev) =>
  isRepeating(ev) && ev.occurrence ? `/events/${ev.id}?date=${ev.occurrence}` : `/events/${ev.id}`
