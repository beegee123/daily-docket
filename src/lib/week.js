// This-week tasks (step 19): pure helpers, no database, so they can be
// tested on their own. A this-week task has weekOf (its Monday) and no
// scheduledDate.

import { addDaysISO, daysBetween, toLocalISODate } from './dates.js'
import { parseLine } from './notes.js'

/** Is this a this-week task rather than a day task? */
export const isWeekTask = (task) => Boolean(task.weekOf)

/** Subtasks = the checklist lines in a task's notes: { done, total }. */
export function checklistProgress(notes) {
  let done = 0
  let total = 0
  for (const line of (notes ?? '').split('\n')) {
    const p = parseLine(line)
    if (p.kind === 'check') {
      total++
      if (p.checked) done++
    }
  }
  return { done, total }
}

/** How much of a task counts toward its job's bar: 1 if done, else the share of subtasks ticked. */
export function taskShare(task) {
  if (task.status === 'done') return 1
  const { done, total } = checklistProgress(task.notes)
  return total ? done / total : 0
}

/** Whole weeks a task has rolled over by the week being viewed. */
export const weeksCarried = (task, weekStart) => Math.max(0, Math.round(daysBetween(task.weekOf, weekStart) / 7))

/**
 * Which this-week tasks belong in the panel for one week.
 *  - This week: everything still open from this week or earlier (rolled
 *    over), plus anything finished during this week.
 *  - A later week: just the tasks planned for that week.
 */
export function tasksForWeek(tasks, weekStart, thisWeek) {
  const weekEnd = addDaysISO(weekStart, 6)
  return tasks.filter((t) => {
    if (!isWeekTask(t) || t.droppedAt) return false
    if (weekStart !== thisWeek) return t.weekOf === weekStart
    if (t.status !== 'done') return t.weekOf <= weekStart
    const doneOn = toLocalISODate(new Date(t.completedAt))
    return doneOn >= weekStart && doneOn <= weekEnd
  })
}

/**
 * Group the week's tasks by job (area) for the panel.
 * A task in several areas sits under the first one in your area order.
 * With an area filter, only that area's tasks, all under it.
 * Returns [{ area, items: [{ task, steps, carried }], done, total, progress }]
 */
export function weekGroups(tasks, areas, { weekStart, areaFilter = null }) {
  const order = new Map(areas.map((a, i) => [a.id, i]))
  const byArea = new Map()

  for (const task of tasks) {
    if (areaFilter && !task.areaIds.includes(areaFilter)) continue
    const areaId =
      areaFilter ?? [...task.areaIds].filter((id) => order.has(id)).sort((a, b) => order.get(a) - order.get(b))[0]
    if (!areaId) continue
    if (!byArea.has(areaId)) byArea.set(areaId, [])
    byArea.get(areaId).push({
      task,
      steps: checklistProgress(task.notes),
      carried: weeksCarried(task, weekStart),
    })
  }

  return [...byArea.entries()]
    .sort(([a], [b]) => order.get(a) - order.get(b))
    .map(([areaId, items]) => {
      // Open first (longest-waiting at the top), then done
      items.sort(
        (x, y) =>
          (x.task.status === 'done') - (y.task.status === 'done') ||
          x.task.weekOf.localeCompare(y.task.weekOf) ||
          x.task.title.localeCompare(y.task.title),
      )
      const done = items.filter((i) => i.task.status === 'done').length
      const share = items.reduce((sum, i) => sum + taskShare(i.task), 0)
      return {
        area: areas[order.get(areaId)],
        items,
        done,
        total: items.length,
        progress: items.length ? share / items.length : 0,
      }
    })
}

/**
 * "Paste a list": text copied from a notes app -> tasks.
 * One task per line. Bullets, numbers and checkboxes at the start are
 * removed. Indented lines become checklist subtasks of the line above,
 * keeping any tick.
 * Returns [{ title, notes }] where notes is '' or '- [ ] step' lines.
 */
export function parsePastedList(text) {
  const MARKER = /^(?:[-*•▪◦]\s+|\d+[.)]\s+|\[[ xX]\]\s*|[☐☑✓✔■□]\s*)/
  const CHECKED = /^(?:\[[xX]\]|[☑✓✔■])/
  const out = []

  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (!raw.trim()) continue
    const indented = /^(\t|\s{2,})/.test(raw)
    let line = raw.trim()
    // Strip up to two markers, e.g. "- [ ] Draft mapping"
    let checked = false
    for (let i = 0; i < 2; i++) {
      const m = line.match(MARKER)
      if (!m) break
      if (CHECKED.test(m[0].trim())) checked = true
      line = line.slice(m[0].length).trim()
    }
    if (!line) continue

    if (indented && out.length) {
      const prev = out[out.length - 1]
      prev.steps.push(`- [${checked ? 'x' : ' '}] ${line}`)
    } else {
      out.push({ title: line.slice(0, 200), steps: [] })
    }
  }
  return out.map(({ title, steps }) => ({ title, notes: steps.join('\n') }))
}
