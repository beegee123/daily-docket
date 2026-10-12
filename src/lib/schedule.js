import { isTrip, shortTime } from './events.js'
import { occurrenceKey } from './repeat.js'

// The Schedule section on Today (step 21): today's meetings in time order,
// and the reminder choices. Plain functions so they can be tested.

/** Reminder choices, in the order the chips show. null = no reminder. */
export const REMIND_CHOICES = [null, 5, 10, 15, 30, 60]
export const DEFAULT_REMIND = 10

/** null -> 'None', 60 -> '1 hr', 10 -> '10 min'. */
export function remindLabel(minutes) {
  if (minutes == null) return 'None'
  return minutes === 60 ? '1 hr' : `${minutes} min`
}

/** '09:30' -> 570 (minutes after midnight). */
export function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

/** Minutes after midnight right now, on this device. */
export function nowMinutes(now = new Date()) {
  return now.getHours() * 60 + now.getMinutes()
}

/** A meeting with no end time counts as 30 minutes long. */
const endMinutes = (ev) => (ev.endTime ? toMinutes(ev.endTime) : toMinutes(ev.startTime) + 30)

/**
 * Today's meetings: events with a start time that start today, earliest
 * first. Trips, all-day events and the later days of a long event keep
 * their banner instead.
 */
export function meetingsFor(events, todayISO) {
  return events
    .filter((ev) => !isTrip(ev) && ev.startTime && ev.startDate === todayISO)
    .sort((a, b) => a.startTime.localeCompare(b.startTime) || a.title.localeCompare(b.title))
}

/** Not on the Schedule: trips, all-day events, and timed events that started on an earlier day. */
export function bannerEvents(events, todayISO) {
  const meetings = new Set(meetingsFor(events, todayISO).map((ev) => ev.id))
  return events.filter((ev) => !meetings.has(ev.id))
}

/** Ticked as attended? `attended` holds occurrenceKey()s, one per date. */
export const isAttended = (ev, attended) => attended.has(occurrenceKey(ev))

/** Has it finished (or been ticked as attended)? Finished ones fade. */
export const isOver = (ev, now, attended) => isAttended(ev, attended) || endMinutes(ev) <= now

/** Every meeting finished or ticked: the section folds itself up. */
export const allOver = (meetings, now, attended) => meetings.every((ev) => isOver(ev, now, attended))

/** The first meeting not finished or ticked, or null. */
export const nextMeeting = (meetings, now, attended) => meetings.find((ev) => !isOver(ev, now, attended)) ?? null

/**
 * "in 8 min" when a meeting starts within its reminder time (10 minutes
 * if it has no reminder), "now" once it has started, else null.
 */
export function soonLabel(ev, now) {
  const until = toMinutes(ev.startTime) - now
  if (until <= 0) return endMinutes(ev) > now ? 'now' : null
  if (until > (ev.remindMinutes ?? DEFAULT_REMIND)) return null
  return until >= 60 ? 'in 1 hr' : `in ${until} min`
}

/**
 * Where the red "now" line goes: before the first meeting that hasn't
 * started. Only between meetings, so -1 before the first or after the last.
 */
export function nowLineIndex(meetings, now) {
  const i = meetings.findIndex((ev) => toMinutes(ev.startTime) > now)
  return i > 0 ? i : -1
}

/** The one line shown when Schedule is folded up. */
export function scheduleSummary(meetings, now, attended) {
  const count = `${meetings.length} ${meetings.length === 1 ? 'meeting' : 'meetings'}`
  const next = nextMeeting(meetings, now, attended)
  if (!next) return `${count} · all done`
  const soon = soonLabel(next, now)
  return `${count} · Next: ${next.title} ${shortTime(next.startTime)}${soon ? ` (${soon})` : ''}`
}
