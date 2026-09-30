import { addDaysISO } from './dates.js'

/**
 * Work out a plan shift without touching the database (a "pure" function:
 * same input, same answer, no side effects), so the screen can preview it.
 *
 * Rules:
 *  - Carried-over tasks count as today's, so everything slides together.
 *  - Nothing moves earlier than today; those land on today instead.
 *  - The new day becomes the task's original day too: a re-plan, not a carry.
 */
export function planShift(tasks, days, todayISO) {
  const moves = tasks
    .map((task) => {
      const base = task.scheduledDate < todayISO ? todayISO : task.scheduledDate
      let to = addDaysISO(base, days)
      const clamped = to < todayISO
      if (clamped) to = todayISO
      return { task, from: task.scheduledDate, to, clamped, carried: task.scheduledDate < todayISO }
    })
    .filter((m) => m.to !== m.from || m.task.originalDate !== m.to)
    .sort((a, b) => a.from.localeCompare(b.from) || a.task.title.localeCompare(b.task.title))

  const last = moves.reduce((acc, m) => (!acc || m.from > acc.from ? m : acc), null)
  const tos = moves.map((m) => m.to).sort()

  return {
    moves,
    count: moves.length,
    carriedCount: moves.filter((m) => m.carried).length,
    // Carried tasks landing on today is expected; only count tasks that were
    // planned for later and got squeezed onto today
    clampedCount: moves.filter((m) => m.clamped && !m.carried).length,
    last, // the task that finished the plan before the shift
    newEnd: tos[tos.length - 1] ?? null, // when the plan finishes after it
    items: moves.map((m) => ({ id: m.task.id, scheduled_date: m.to, original_date: m.to })),
    undoItems: moves.map((m) => ({
      id: m.task.id,
      scheduled_date: m.task.scheduledDate,
      original_date: m.task.originalDate,
    })),
  }
}
