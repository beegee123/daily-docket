import { describe, expect, it } from 'vitest'
import { feedUrl, googleAddUrl, webcalUrl } from './calendar.js'

const TOKEN = 'a'.repeat(64)

describe('calendar links', () => {
  it('points at the calendar-feed function with the token', () => {
    expect(feedUrl('https://abc.supabase.co', TOKEN)).toBe(`https://abc.supabase.co/functions/v1/calendar-feed?token=${TOKEN}`)
  })
  it('copes with a trailing slash on the project URL', () => {
    expect(feedUrl('https://abc.supabase.co/', TOKEN)).toBe(`https://abc.supabase.co/functions/v1/calendar-feed?token=${TOKEN}`)
  })
  it('swaps https for webcal', () => {
    expect(webcalUrl('https://abc.supabase.co/x?token=1')).toBe('webcal://abc.supabase.co/x?token=1')
  })
  it('builds Google Calendar’s add page with the link encoded', () => {
    const url = googleAddUrl(`https://abc.supabase.co/functions/v1/calendar-feed?token=${TOKEN}`)
    expect(url.startsWith('https://calendar.google.com/calendar/r?cid=webcal%3A%2F%2Fabc.supabase.co')).toBe(true)
    expect(decodeURIComponent(new URL(url).searchParams.get('cid'))).toBe(
      `webcal://abc.supabase.co/functions/v1/calendar-feed?token=${TOKEN}`,
    )
  })
})
