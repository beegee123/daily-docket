import { describe, expect, it } from 'vitest'
import {
  allOver,
  bannerEvents,
  meetingsFor,
  nextMeeting,
  nowLineIndex,
  remindLabel,
  scheduleSummary,
  soonLabel,
  toMinutes,
} from './schedule.js'

const today = '2026-10-13'
const ev = (id, title, startTime, endTime = null, extra = {}) => ({
  id,
  title,
  startDate: today,
  endDate: today,
  startTime,
  endTime,
  personId: null,
  remindMinutes: 10,
  ...extra,
})

const standup = ev('s', 'TDX standup', '09:30', '09:45')
const review = ev('r', 'V1 sprint review', '11:00', '12:00')
const call = ev('c', 'Client call', '14:00', null, { remindMinutes: 30 })
const trip = { ...ev('t', 'Chicago', null), personId: 'him', endDate: '2026-10-15' }
const allDay = ev('a', 'PD1 exam', null)
const conference = ev('k', 'Conference', '09:00', '17:00', { startDate: '2026-10-12' })
const events = [call, trip, review, allDay, standup, conference]
const none = new Set()

describe('which events are meetings', () => {
  it('takes timed events starting today, earliest first', () => {
    expect(meetingsFor(events, today).map((e) => e.id)).toEqual(['s', 'r', 'c'])
  })
  it('leaves trips, all-day and carried-on events as banners', () => {
    expect(bannerEvents(events, today).map((e) => e.id)).toEqual(['t', 'a', 'k'])
  })
})

describe('during the day', () => {
  const meetings = meetingsFor(events, today)
  const at = (hhmm) => toMinutes(hhmm)

  it('finds the next meeting, skipping finished and ticked ones', () => {
    expect(nextMeeting(meetings, at('10:52'), none).id).toBe('r')
    expect(nextMeeting(meetings, at('09:40'), none).id).toBe('s') // still running
    expect(nextMeeting(meetings, at('09:40'), new Set(['s@2026-10-13'])).id).toBe('r')
  })

  it('counts a meeting with no end time as 30 minutes', () => {
    expect(nextMeeting(meetings, at('14:20'), none).id).toBe('c')
    expect(nextMeeting(meetings, at('14:30'), none)).toBeNull()
  })

  it('knows when everything is over', () => {
    expect(allOver(meetings, at('13:00'), none)).toBe(false)
    expect(allOver(meetings, at('13:00'), new Set(['c@2026-10-13']))).toBe(true)
  })

  it('says "in 8 min" only inside the reminder time, and "now" once started', () => {
    expect(soonLabel(review, at('10:52'))).toBe('in 8 min')
    expect(soonLabel(review, at('10:40'))).toBeNull()
    expect(soonLabel(call, at('13:31'))).toBe('in 29 min') // 30-minute reminder
    expect(soonLabel(review, at('11:05'))).toBe('now')
    expect(soonLabel(review, at('12:00'))).toBeNull()
    expect(soonLabel({ ...review, remindMinutes: 60 }, at('10:00'))).toBe('in 1 hr')
  })

  it('puts the now line between meetings only', () => {
    expect(nowLineIndex(meetings, at('10:52'))).toBe(1)
    expect(nowLineIndex(meetings, at('08:00'))).toBe(-1)
    expect(nowLineIndex(meetings, at('15:00'))).toBe(-1)
  })

  it('sums it up in one line', () => {
    expect(scheduleSummary(meetings, at('10:52'), new Set(['s@2026-10-13']))).toBe(
      '3 meetings · Next: V1 sprint review 11 am (in 8 min)',
    )
    expect(scheduleSummary(meetings, at('12:30'), none)).toBe('3 meetings · Next: Client call 2 pm')
    expect(scheduleSummary([standup], at('18:00'), none)).toBe('1 meeting · all done')
  })
})

describe('reminder labels', () => {
  it('names each choice', () => {
    expect([null, 5, 60].map(remindLabel)).toEqual(['None', '5 min', '1 hr'])
  })
})
