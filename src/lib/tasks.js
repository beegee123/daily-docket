import { toLocalISODate } from './dates.js'

// The rules for what a task "is" on a given day.
// Small, plain functions: they take a task and return an answer or a
// NEW task. They never change the task they were given (React relies on
// getting a new object to notice something changed).

/** Not done, not dropped, and on the docket today or earlier. */
export function isOpen(task, todayISO) {
  // A this-week task has no day, so it's never open on Today
  return !task.droppedAt && task.status !== 'done' && Boolean(task.scheduledDate) && task.scheduledDate <= todayISO
}

/** Open, and first put on a docket before today. */
export function isCarried(task, todayISO) {
  return isOpen(task, todayISO) && task.originalDate < todayISO
}

/** Completed on the given day (in the user's own timezone). */
export function isDoneOn(task, todayISO) {
  return (
    !task.droppedAt &&
    task.status === 'done' &&
    Boolean(task.completedAt) &&
    toLocalISODate(new Date(task.completedAt)) === todayISO
  )
}

/** Does this task belong to the area? `null` means "All areas". */
export function inArea(task, areaId) {
  return areaId === null || task.areaIds.includes(areaId)
}

/** A copy of the task, marked done right now. */
export function completeTask(task, now = new Date()) {
  return { ...task, status: 'done', completedAt: now.toISOString() }
}

/** A copy of the task, back to open. */
export function reopenTask(task) {
  return { ...task, status: 'todo', completedAt: null }
}

/** Done -> open, open -> done. */
export function toggleDone(task) {
  return task.status === 'done' ? reopenTask(task) : completeTask(task)
}

/**
 * Is this task my job? Assigned to me, or unassigned and added by me.
 * (A task I added but assigned to someone else is theirs.)
 * Tasks loaded before sharing existed have no createdBy: treat as mine.
 */
export function isMyJob(task, meId) {
  if (task.assignedTo) return task.assignedTo === meId
  return !task.createdBy || task.createdBy === meId
}

/** For the "Mine" filter: assigned to me, or not assigned to anyone. */
export function isForMe(task, meId) {
  return !task.assignedTo || task.assignedTo === meId
}
