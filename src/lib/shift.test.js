import { describe, expect, it } from 'vitest'
import { planShift } from './shift.js'

// Monday 5 Oct 2026 is "this week"; today is Wednesday 7 Oct
const TODAY = '2026-10-07'
const day = (title, date) => ({ id: title, title, scheduledDate: date, originalDate: date, weekOf: null, areaIds: ['a'] })
const week = (title, monday) => ({ id: title, title, scheduledDate: null, originalDate: monday, weekOf: monday, areaIds: ['a'] })

describe('planShift', () => {
  it('moves day tasks by days, as before', () => {
    const plan = planShift([day('Read ch 3', '2026-10-09')], 2, TODAY)
    expect(plan.items).toEqual([{ id: 'Read ch 3', scheduled_date: '2026-10-11', original_date: '2026-10-11' }])
  })
  it('leaves this-week tasks alone for shifts under a week', () => {
    const plan = planShift([week('AN', '2026-10-05')], 3, TODAY)
    expect(plan.count).toBe(0)
    expect(plan.weekTasksStaying).toBe(1)
  })
  it('moves this-week tasks a week per 7 days, and can undo', () => {
    const plan = planShift([week('AN', '2026-10-05'), day('Mock exam', '2026-10-08')], 7, TODAY)
    expect(plan.items).toContainEqual({ id: 'AN', week_of: '2026-10-12', original_date: '2026-10-12' })
    expect(plan.items).toContainEqual({ id: 'Mock exam', scheduled_date: '2026-10-15', original_date: '2026-10-15' })
    expect(plan.undoItems).toContainEqual({ id: 'AN', week_of: '2026-10-05', original_date: '2026-10-05' })
    // The plan now ends on the Sunday of the week AN moved to
    expect(plan.newEnd).toBe('2026-10-18')
  })
  it('rolled-over week tasks count as this week, and never go earlier', () => {
    const rolled = week('Old', '2026-09-28')
    expect(planShift([rolled], 7, TODAY).items[0].week_of).toBe('2026-10-12')
    expect(planShift([week('Next', '2026-10-12')], -14, TODAY).items[0].week_of).toBe('2026-10-05')
  })
})
