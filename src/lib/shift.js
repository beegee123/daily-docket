import { addDaysISO, startOfWeekISO } from './dates.js'

/**
 * Work out a plan shift without touching the database (a "pure" function:
 * same input, same answer, no side effects), so the screen can preview it.
 *
 * Rules:
 *  - Carried-over tasks count as today's, so everything slides together.
 *  - Nothing moves earlier than today; those land on today instead.
 *  - The new day becomes the task's original day too: a re-plan, not a carry.
 *  - This-week tasks (no day, just a week) move a whole week for every 7
 *    days of shift, rounded toward zero, so a 3-day shift leaves them be.
 *    Rolled-over ones count as this week's; none go before this week.
 */
export function planShift(tasks, days, todayISO) {
  const thisWeek = startOfWeekISO(todayISO)
  const weeks = Math.trunc(days / 7)

  const dayMoves = tasks
    .filter((task) => !task.weekOf)
    .map((task) => {
      const base = task.scheduledDate < todayISO ? todayISO : task.scheduledDate
      let to = addDaysISO(base, days)
      const clamped = to < todayISO
      if (clamped) to = todayISO
      return { task, from: task.scheduledDate, to, clamped, carried: task.scheduledDate < todayISO, week: false }
    })

  const weekMoves = tasks
    .filter((task) => task.weekOf)
    .map((task) => {
      const base = task.weekOf < thisWeek ? thisWeek : task.weekOf
      let to = addDaysISO(base, weeks * 7)
      const clamped = to < thisWeek
      if (clamped) to = thisWeek
      return { task, from: task.weekOf, to, clamped, carried: task.weekOf < thisWeek, week: true }
    })

  const moves = [...dayMoves, ...weekMoves]
    // A move that changes nothing isn't a move. Without a whole week of
    // shift, this-week tasks stay exactly where they are.
    .filter((m) => (m.week ? weeks !== 0 && m.to !== m.from : m.to !== m.from || m.task.originalDate !== m.to))
    .sort((a, b) => a.from.localeCompare(b.from) || a.task.title.localeCompare(b.task.title))

  // A week "ends" on its Sunday, for finding the last task and the new finish
  const endOf = (m, key) => (m.week ? addDaysISO(m[key], 6) : m[key])
  const last = moves.reduce((acc, m) => (!acc || endOf(m, 'from') > endOf(acc, 'from') ? m : acc), null)
  const tos = moves.map((m) => endOf(m, 'to')).sort()

  return {
    moves,
    count: moves.length,
    carriedCount: moves.filter((m) => m.carried).length,
    // Carried tasks landing on today is expected; only count tasks that were
    // planned for later and got squeezed onto today
    clampedCount: moves.filter((m) => m.clamped && !m.carried).length,
    // This-week tasks that a shift of under 7 days leaves where they are
    weekTasksStaying: weeks === 0 ? weekMoves.length : 0,
    last, // the task that finished the plan before the shift
    newEnd: tos[tos.length - 1] ?? null, // when the plan finishes after it
    items: moves.map((m) =>
      m.week
        ? { id: m.task.id, week_of: m.to, original_date: m.to }
        : { id: m.task.id, scheduled_date: m.to, original_date: m.to },
    ),
    undoItems: moves.map((m) =>
      m.week
        ? { id: m.task.id, week_of: m.task.weekOf, original_date: m.task.originalDate }
        : { id: m.task.id, scheduled_date: m.task.scheduledDate, original_date: m.task.originalDate },
    ),
  }
}
