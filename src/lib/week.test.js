import { describe, expect, it } from 'vitest'
import { checklistProgress, parsePastedList, taskShare, tasksForWeek, weekGroups, weeksCarried } from './week.js'

const areas = [
  { id: 'work', name: 'Work' },
  { id: 'tdx', name: 'TDX' },
  { id: 'v1', name: 'V1' },
]
const THIS_WEEK = '2026-10-05'
const task = (over) => ({
  id: over.title,
  title: 'x',
  notes: null,
  status: 'todo',
  scheduledDate: null,
  weekOf: THIS_WEEK,
  completedAt: null,
  droppedAt: null,
  areaIds: ['tdx'],
  ...over,
})

describe('subtasks', () => {
  it('counts checklist lines in notes, ignoring other lines', () => {
    expect(checklistProgress('Intro\n- [x] Pull\n- [ ] Draft\n- bullet\n- [X] Sign')).toEqual({ done: 2, total: 3 })
    expect(checklistProgress(null)).toEqual({ done: 0, total: 0 })
  })
  it('a part-done task counts as its share', () => {
    expect(taskShare(task({ notes: '- [x] a\n- [x] b\n- [ ] c\n- [ ] d\n- [ ] e' }))).toBeCloseTo(0.4)
    expect(taskShare(task({ status: 'done' }))).toBe(1)
    expect(taskShare(task({}))).toBe(0)
  })
})

describe('which tasks show in a week', () => {
  const rolled = task({ title: 'AN', weekOf: '2026-09-28' })
  const current = task({ title: 'Sandbox' })
  const doneThisWeek = task({ title: 'Done Tue', status: 'done', completedAt: '2026-10-06T15:00:00Z' })
  const doneLastWeek = task({ title: 'Done before', weekOf: '2026-09-28', status: 'done', completedAt: '2026-10-02T15:00:00Z' })
  const nextWeek = task({ title: 'Next', weekOf: '2026-10-12' })
  const dayTask = task({ title: 'Day', weekOf: null, scheduledDate: '2026-10-05' })
  const dropped = task({ title: 'Dropped', droppedAt: '2026-10-05T10:00:00Z' })
  const all = [rolled, current, doneThisWeek, doneLastWeek, nextWeek, dayTask, dropped]

  it('this week: open from now or earlier, plus done this week', () => {
    expect(tasksForWeek(all, THIS_WEEK, THIS_WEEK).map((t) => t.title).sort()).toEqual(['AN', 'Done Tue', 'Sandbox'])
  })
  it('a later week: only what was planned for it', () => {
    expect(tasksForWeek(all, '2026-10-12', THIS_WEEK).map((t) => t.title)).toEqual(['Next'])
  })
  it('counts how many weeks a task has rolled over', () => {
    expect(weeksCarried(rolled, THIS_WEEK)).toBe(1)
    expect(weeksCarried(current, THIS_WEEK)).toBe(0)
    expect(weeksCarried(task({ weekOf: '2026-09-21' }), THIS_WEEK)).toBe(2)
  })
})

describe('panel groups', () => {
  const tasks = [
    task({ title: 'Sandbox refresh', status: 'done', completedAt: '2026-10-05T14:00:00Z' }),
    task({ title: 'AN', notes: '- [x] a\n- [x] b\n- [ ] c\n- [ ] d\n- [ ] e' }),
    task({ title: 'Devops pipeline' }),
    task({ title: 'E2C', areaIds: ['v1'] }),
    task({ title: 'Both', areaIds: ['v1', 'work'] }),
  ]

  it('groups by job in area order, with done count and partial progress', () => {
    const groups = weekGroups(tasks, areas, { weekStart: THIS_WEEK })
    expect(groups.map((g) => g.area.name)).toEqual(['Work', 'TDX', 'V1'])
    const tdx = groups[1]
    expect([tdx.done, tdx.total]).toEqual([1, 3])
    expect(tdx.progress).toBeCloseTo(1.4 / 3)
    expect(tdx.items.map((i) => i.task.title)).toEqual(['AN', 'Devops pipeline', 'Sandbox refresh'])
    expect(tdx.items[0].steps).toEqual({ done: 2, total: 5 })
  })
  it('a task in two areas sits under the first in your order', () => {
    const groups = weekGroups(tasks, areas, { weekStart: THIS_WEEK })
    expect(groups[0].items.map((i) => i.task.title)).toEqual(['Both'])
  })
  it('with a filter, shows only that area', () => {
    const groups = weekGroups(tasks, areas, { weekStart: THIS_WEEK, areaFilter: 'v1' })
    expect(groups.map((g) => g.area.name)).toEqual(['V1'])
    expect(groups[0].total).toBe(2)
  })
})

describe('paste a list', () => {
  it('one task per line, markers removed', () => {
    const text = 'Sandbox refresh\n- AN\n☐ Devops pipeline\n1. Confluence\n[ ] Queue\n\n'
    expect(parsePastedList(text).map((t) => t.title)).toEqual(['Sandbox refresh', 'AN', 'Devops pipeline', 'Confluence', 'Queue'])
  })
  it('indented lines become subtasks, keeping ticks', () => {
    const text = 'AN\n  - [x] Pull requirements\n  - [ ] Draft mapping\n\tBuild flow\nDevops'
    expect(parsePastedList(text)).toEqual([
      { title: 'AN', notes: '- [x] Pull requirements\n- [ ] Draft mapping\n- [ ] Build flow' },
      { title: 'Devops', notes: '' },
    ])
  })
  it('handles Windows line endings and blank input', () => {
    expect(parsePastedList('A\r\nB\r\n').map((t) => t.title)).toEqual(['A', 'B'])
    expect(parsePastedList('   \n')).toEqual([])
  })
})
