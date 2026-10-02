import { formatDayMonth } from './dates.js'
import { shortName } from './people.js'

/** '14:00' -> '2:00 pm', '09:15' -> '9:15 am'. */
export function formatTime(hhmm) {
  const [h, m] = hhmm.split(':').map(Number)
  const suffix = h < 12 ? 'am' : 'pm'
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${suffix}`
}

/** Shorter for tight spaces: '14:00' -> '2 pm', '14:30' -> '2:30 pm'. */
export function shortTime(hhmm) {
  return formatTime(hhmm).replace(':00', '')
}

/** '2:00 pm', or '2:00 – 3:30 pm' / '11:00 am – 1:00 pm' when there's an end time. */
export function timeRange(event) {
  if (!event.startTime) return ''
  if (!event.endTime) return formatTime(event.startTime)
  const start = formatTime(event.startTime)
  const end = formatTime(event.endTime)
  // Drop the first am/pm when both are the same half of the day
  const sameHalf = start.slice(-2) === end.slice(-2)
  return `${sameHalf ? start.slice(0, -3) : start} – ${end}`
}

/** Is it a trip (someone away) rather than an event? */
export const isTrip = (event) => Boolean(event.personId)

/** Who's away, in words: "You're away", "Husband away". */
function awayWho(event, meId, people) {
  return event.personId === meId ? "You're away" : `${shortName(people[event.personId])} away`
}

/**
 * Banner text for Today:
 * "Husband away · Chicago · back Thu 4 Oct", "Today · 2:00 pm · PD1 exam",
 * "Today: PD1 exam" (all day) or "Conference · until Wed 21 Oct".
 */
export function eventBanner(event, todayISO, meId, people) {
  if (isTrip(event)) {
    const back = event.endDate === todayISO ? 'back today' : `back ${formatDayMonth(event.endDate)}`
    return `${awayWho(event, meId, people)} · ${event.title} · ${back}`
  }
  const startsToday = event.startDate === todayISO
  const time = startsToday && event.startTime ? `${timeRange(event)} · ` : ''
  if (event.startDate === event.endDate) return time ? `Today · ${time}${event.title}` : `Today: ${event.title}`
  return `${time}${event.title} · until ${formatDayMonth(event.endDate)}`
}

/** Short tag for a day on the Week screen: "Husband away", "2 pm PD1 exam", "PD1 exam". */
export function eventTag(event, meId, people, dayISO = null) {
  if (isTrip(event)) return event.personId === meId ? 'You away' : `${shortName(people[event.personId])} away`
  const showTime = event.startTime && (dayISO === null || dayISO === event.startDate)
  return showTime ? `${shortTime(event.startTime)} ${event.title}` : event.title
}

/** "Thu 1 Oct", "Thu 5 Nov · 2:00 – 3:30 pm" or "Thu 1 Oct – Sun 4 Oct". */
export function eventDates(event) {
  const days =
    event.startDate === event.endDate
      ? formatDayMonth(event.startDate)
      : `${formatDayMonth(event.startDate)} – ${formatDayMonth(event.endDate)}`
  return event.startTime ? `${days} · ${timeRange(event)}` : days
}

/** Does an event cover this day? */
export const coversDay = (event, iso) => event.startDate <= iso && event.endDate >= iso
