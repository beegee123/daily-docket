import { describe, expect, it } from 'vitest'
import { eventBanner, eventDates, eventTag, formatTime, shortTime, timeRange } from './events.js'

const ME = 'me'
const people = { him: 'husband@example.com' }
const exam = { personId: null, title: 'PD1 exam', startDate: '2026-11-05', endDate: '2026-11-05', startTime: null, endTime: null }
const timed = { ...exam, startTime: '14:00', endTime: '15:30' }
const trip = { personId: 'him', title: 'Chicago', startDate: '2026-10-05', endDate: '2026-10-08', startTime: null, endTime: null }

describe('times', () => {
  it('formats 12-hour times', () => {
    expect(formatTime('14:00')).toBe('2:00 pm')
    expect(formatTime('09:15')).toBe('9:15 am')
    expect(formatTime('00:30')).toBe('12:30 am')
    expect(formatTime('12:00')).toBe('12:00 pm')
  })
  it('shortens whole hours', () => {
    expect(shortTime('14:00')).toBe('2 pm')
    expect(shortTime('14:30')).toBe('2:30 pm')
  })
  it('writes ranges without repeating am/pm', () => {
    expect(timeRange(timed)).toBe('2:00 – 3:30 pm')
    expect(timeRange({ ...timed, startTime: '11:00', endTime: '13:00' })).toBe('11:00 am – 1:00 pm')
    expect(timeRange({ ...timed, endTime: null })).toBe('2:00 pm')
    expect(timeRange(exam)).toBe('')
  })
})

describe('labels', () => {
  it('Today banner shows the time for a timed event', () => {
    expect(eventBanner(timed, '2026-11-05', ME, people)).toBe('Today · 2:00 – 3:30 pm · PD1 exam')
    expect(eventBanner(exam, '2026-11-05', ME, people)).toBe('Today: PD1 exam')
  })
  it('trips are unchanged', () => {
    expect(eventBanner(trip, '2026-10-06', ME, people)).toBe('Husband away · Chicago · back Thu 8 Oct')
    expect(eventTag(trip, ME, people, '2026-10-06')).toBe('Husband away')
  })
  it('Week tag puts the time first, only on the first day', () => {
    expect(eventTag(timed, ME, people, '2026-11-05')).toBe('2 pm PD1 exam')
    const conf = { ...timed, title: 'Conference', endDate: '2026-11-06', endTime: '12:00' }
    expect(eventTag(conf, ME, people, '2026-11-06')).toBe('Conference')
  })
  it('list shows date and time', () => {
    expect(eventDates(timed)).toBe('Thu 5 Nov · 2:00 – 3:30 pm')
    expect(eventDates(exam)).toBe('Thu 5 Nov')
  })
})
