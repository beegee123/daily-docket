import { describe, expect, it } from 'vitest'
import { eventLink, expandAll, expandEvent, nextOccurrence, occurrenceKey, occursOn, repeatSummary } from './repeat.js'

// Mon 12 Oct 2026
const base = { id: 's', title: 'Standup', startDate: '2026-10-12', endDate: '2026-10-12', startTime: '09:30' }
const dates = (ev, from, to) => expandEvent(ev, from, to).map((e) => e.startDate)

describe('patterns (same rules as docket.occurs_on)', () => {
  it('every week on chosen days', () => {
    const ev = { ...base, repeat: 'weekly', repeatDays: [1, 4] }
    expect(dates(ev, '2026-10-01', '2026-10-25')).toEqual(['2026-10-12', '2026-10-15', '2026-10-19', '2026-10-22'])
  })
  it('every 2 weeks counts from the first week', () => {
    const ev = { ...base, repeat: 'biweekly', repeatDays: [1] }
    expect(dates(ev, '2026-10-12', '2026-11-12')).toEqual(['2026-10-12', '2026-10-26', '2026-11-09'])
    // Starting on a Friday with Mondays picked: the first Monday is two weeks on
    expect(dates({ ...ev, startDate: '2026-10-16', endDate: '2026-10-16' }, '2026-10-16', '2026-11-12')).toEqual([
      '2026-10-26',
      '2026-11-09',
    ])
  })
  it('every weekday', () => {
    const ev = { ...base, repeat: 'weekdays', startDate: '2026-10-15', endDate: '2026-10-15' }
    expect(dates(ev, '2026-10-12', '2026-10-20')).toEqual(['2026-10-15', '2026-10-16', '2026-10-19', '2026-10-20'])
  })
  it('every month on the same date, skipping months without it', () => {
    const ev = { ...base, repeat: 'monthly', startDate: '2026-10-31', endDate: '2026-10-31' }
    expect(dates(ev, '2026-10-01', '2027-01-31')).toEqual(['2026-10-31', '2026-12-31', '2027-01-31'])
  })
  it('stops at the until date and leaves out skipped dates', () => {
    const ev = { ...base, repeat: 'weekly', repeatDays: [1], repeatUntil: '2026-11-02', skips: ['2026-10-26'] }
    expect(dates(ev, '2026-10-01', '2026-12-31')).toEqual(['2026-10-12', '2026-10-19', '2026-11-02'])
    expect(occursOn(ev, '2026-10-26')).toBe(false)
  })
  it('leaves a plain event alone', () => {
    expect(expandEvent(base, '2026-10-01', '2026-10-31')).toEqual([{ ...base, occurrence: '2026-10-12' }])
  })
})

describe('using the dates', () => {
  const weekly = { ...base, repeat: 'weekly', repeatDays: [1] }
  it('each copy looks like a one-day event on its date', () => {
    const [first, second] = expandEvent(weekly, '2026-10-12', '2026-10-19')
    expect(second).toMatchObject({ id: 's', startDate: '2026-10-19', endDate: '2026-10-19', seriesStart: '2026-10-12' })
    expect(occurrenceKey(first)).toBe('s@2026-10-12')
    expect(eventLink(second)).toBe('/events/s?date=2026-10-19')
    expect(eventLink(base)).toBe('/events/s')
  })
  it('sorts several events by day, then time', () => {
    const lunch = { ...base, id: 'l', title: 'Lunch', startTime: '12:00', repeat: 'weekdays' }
    const ids = expandAll([lunch, weekly], '2026-10-12', '2026-10-13').map((e) => `${e.startDate} ${e.id}`)
    expect(ids).toEqual(['2026-10-12 s', '2026-10-12 l', '2026-10-13 l'])
  })
  it('finds the next date', () => {
    expect(nextOccurrence(weekly, '2026-10-13')).toBe('2026-10-19')
    expect(nextOccurrence({ ...weekly, repeatUntil: '2026-10-18' }, '2026-10-13')).toBeNull()
  })
})

describe('in words', () => {
  it('describes the pattern', () => {
    expect(repeatSummary({ ...base, repeat: 'weekly', repeatDays: [1] })).toBe('Every Monday')
    expect(repeatSummary({ ...base, repeat: 'weekly', repeatDays: [4, 1] })).toBe('Every Mon and Thu')
    expect(repeatSummary({ ...base, repeat: 'biweekly', repeatDays: [1, 3, 5] })).toBe(
      'Every 2 weeks on Mon, Wed and Fri',
    )
    expect(repeatSummary({ ...base, repeat: 'weekdays', repeatUntil: '2026-12-18' })).toBe(
      'Every weekday · until Fri 18 Dec',
    )
    expect(repeatSummary({ ...base, repeat: 'monthly', startDate: '2026-10-22' })).toBe('Every month on the 22nd')
    expect(repeatSummary({ ...base, repeat: 'monthly', startDate: '2026-10-11' })).toBe('Every month on the 11th')
  })
})
