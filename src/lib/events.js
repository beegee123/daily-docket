import { formatDayMonth } from './dates.js'
import { shortName } from './people.js'

/** Who's away, in words: "You're away", "Husband away". */
function awayWho(event, meId, people) {
  return event.personId === meId ? "You're away" : `${shortName(people[event.personId])} away`
}

/** Banner text for Today: "Husband away · Chicago · back Thu 4 Oct" or "Today: PD1 exam". */
export function eventBanner(event, todayISO, meId, people) {
  if (event.personId) {
    const back = event.endDate === todayISO ? 'back today' : `back ${formatDayMonth(event.endDate)}`
    return `${awayWho(event, meId, people)} · ${event.title} · ${back}`
  }
  if (event.startDate === event.endDate) return `Today: ${event.title}`
  return `${event.title} · until ${formatDayMonth(event.endDate)}`
}

/** Short tag for a day on the Week screen. */
export function eventTag(event, meId, people) {
  if (!event.personId) return event.title
  return event.personId === meId ? 'You away' : `${shortName(people[event.personId])} away`
}

/** "Thu 1 Oct" or "Thu 1 Oct – Sun 4 Oct". */
export function eventDates(event) {
  return event.startDate === event.endDate
    ? formatDayMonth(event.startDate)
    : `${formatDayMonth(event.startDate)} – ${formatDayMonth(event.endDate)}`
}

/** Does an event cover this day? */
export const coversDay = (event, iso) => event.startDate <= iso && event.endDate >= iso
