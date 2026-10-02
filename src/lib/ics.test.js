import { describe, expect, it } from 'vitest'
import {
  buildCalendar,
  escapeText,
  foldLine,
  icsStamp,
  nextDay,
  summaryFor,
  zonedToUtc,
} from '../../supabase/functions/calendar-feed/index.ts'

// The calendar feed's text builder lives with the Edge Function, so the
// function and these tests share one copy.

const BEE = 'bee-id'
const HUSBAND = 'husband-id'

const trip = {
  id: 'e1',
  title: 'Chicago',
  start_date: '2026-10-05',
  end_date: '2026-10-08',
  start_time: null,
  end_time: null,
  time_zone: 'America/New_York',
  notes: null,
  updated_at: '2026-10-02T18:15:00.123Z',
  area_name: 'Home',
  person_id: HUSBAND,
  person_email: 'husband@example.com',
}

describe('dates', () => {
  it('ends an all-day event the morning after the last day', () => {
    expect(nextDay('2026-10-08')).toBe('2026-10-09')
  })
  it('rolls over months and years', () => {
    expect(nextDay('2026-10-31')).toBe('2026-11-01')
    expect(nextDay('2026-12-31')).toBe('2027-01-01')
    expect(nextDay('2028-02-28')).toBe('2028-02-29')
  })
  it('writes timestamps in UTC without dashes or milliseconds', () => {
    expect(icsStamp('2026-10-02T18:15:00.123Z')).toBe('20261002T181500Z')
  })
})

describe('summary', () => {
  it('says whose trip it is from the viewer’s side', () => {
    expect(summaryFor(trip, BEE)).toBe('Husband away · Chicago')
    expect(summaryFor(trip, HUSBAND)).toBe("You're away · Chicago")
  })
  it('uses the plain title for an event with no one away', () => {
    expect(summaryFor({ ...trip, person_id: null, title: 'PD1 exam' }, BEE)).toBe('PD1 exam')
  })
})

describe('text rules', () => {
  it('escapes commas, semicolons, backslashes and line breaks', () => {
    expect(escapeText('Hotel, room 4; bring a\\b\nflight 7am')).toBe('Hotel\\, room 4\\; bring a\\\\b\\nflight 7am')
  })
  it('leaves short lines alone', () => {
    expect(foldLine('SUMMARY:Chicago')).toBe('SUMMARY:Chicago')
  })
  it('wraps long lines at 75 bytes with a leading space', () => {
    const folded = foldLine('DESCRIPTION:' + 'x'.repeat(200))
    const lines = folded.split('\r\n')
    expect(lines.length).toBe(3)
    for (const line of lines) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75)
    expect(lines[1].startsWith(' ')).toBe(true)
    expect(lines.map((l, i) => (i ? l.slice(1) : l)).join('')).toBe('DESCRIPTION:' + 'x'.repeat(200))
  })
  it('never splits a multi-byte character', () => {
    const folded = foldLine('SUMMARY:' + 'é✈'.repeat(40))
    for (const line of folded.split('\r\n')) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75)
      expect(line).not.toContain('�')
    }
  })
})

describe('whole calendar', () => {
  const ics = buildCalendar([trip, { ...trip, id: 'e2', person_id: null, title: 'PD1 exam', start_date: '2026-11-02', end_date: '2026-11-02', notes: '- Pencils\n- ID', area_name: 'PD1' }], BEE)

  it('uses CRLF line endings and wraps everything in VCALENDAR', () => {
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true)
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true)
    expect(ics.replace(/\r\n/g, '')).not.toMatch(/\n/)
  })
  it('names the calendar Daily Docket', () => {
    expect(ics).toContain('X-WR-CALNAME:Daily Docket')
  })
  it('writes a trip as all-day blocks from leaving to the day after coming back', () => {
    expect(ics).toContain('UID:e1@docket.preciousdoxa.com')
    expect(ics).toContain('DTSTART;VALUE=DATE:20261005')
    expect(ics).toContain('DTEND;VALUE=DATE:20261009')
    expect(ics).toContain('SUMMARY:Husband away · Chicago')
  })
  it('puts notes and the area in the description', () => {
    expect(ics).toContain('DESCRIPTION:- Pencils\\n- ID\\n\\nArea: PD1')
    expect(ics).toContain('DESCRIPTION:Area: Home')
  })
  it('has two events', () => {
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2)
  })
})

describe('timed events', () => {
  const exam = { ...trip, id: 'e3', person_id: null, title: 'PD1 exam', start_date: '2026-11-05', end_date: '2026-11-05', start_time: '14:00:00', end_time: '15:30:00' }

  it('converts New York time to UTC, before and after the clocks change', () => {
    expect(zonedToUtc('2026-10-05', '14:00:00', 'America/New_York')).toBe('20261005T180000Z') // EDT, UTC-4
    expect(zonedToUtc('2026-11-05', '14:00:00', 'America/New_York')).toBe('20261105T190000Z') // EST, UTC-5
    expect(zonedToUtc('2026-11-01', '01:30:00', 'America/Chicago')).toBe('20261101T063000Z')
    expect(zonedToUtc('2026-10-05', '09:00:00', 'Europe/London')).toBe('20261005T080000Z')
  })
  it('writes a timed event with UTC start and end, shown as busy', () => {
    const ics = buildCalendar([exam], BEE)
    expect(ics).toContain('DTSTART:20261105T190000Z')
    expect(ics).toContain('DTEND:20261105T203000Z')
    expect(ics).toContain('TRANSP:OPAQUE')
    expect(ics).not.toContain('VALUE=DATE')
  })
  it('lasts one hour when there is no end time', () => {
    const ics = buildCalendar([{ ...exam, end_time: null }], BEE)
    expect(ics).toContain('DTEND:20261105T200000Z')
  })
  it('keeps trips as whole days even if a time slipped in', () => {
    const ics = buildCalendar([{ ...trip, start_time: '06:15:00' }], BEE)
    expect(ics).toContain('DTSTART;VALUE=DATE:20261005')
    expect(ics).toContain('TRANSP:TRANSPARENT')
  })
})
