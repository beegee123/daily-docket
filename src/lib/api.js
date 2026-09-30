import { supabase } from './supabase.js'

// Every call to the database lives here, so screens never talk to
// Supabase directly. Row-level security quietly limits every query to
// the signed-in person's rows; nothing here filters by user.

// The database says scheduled_date; JavaScript code says scheduledDate.
// These two translators are the only place that difference exists.
function areaFromDb(row) {
  return { id: row.id, name: row.name, color: row.color, sortOrder: row.sort_order }
}

function taskFromDb(row) {
  return {
    id: row.id,
    title: row.title,
    notes: row.notes,
    status: row.status,
    scheduledDate: row.scheduled_date,
    originalDate: row.original_date,
    dueDate: row.due_date,
    completedAt: row.completed_at,
    droppedAt: row.dropped_at,
    areaIds: (row.task_areas ?? []).map((link) => link.area_id),
  }
}

/** Gives a new user their four starter areas. Does nothing if they have some. */
export async function seedStarterAreas() {
  const { error } = await supabase.rpc('seed_starter_areas')
  if (error) throw error
}

export async function fetchAreas() {
  const { data, error } = await supabase
    .from('areas')
    .select('id, name, color, sort_order')
    .order('sort_order')
  if (error) throw error
  return data.map(areaFromDb)
}

/**
 * Everything the Today screen needs:
 *   - open tasks on the docket today or earlier (includes carry-overs)
 *   - tasks completed since the start of today, local time
 * todayISO and startOfTodayISO come from the browser, not the database,
 * so "today" means today where you are, not today in UTC.
 */
const TASK_COLUMNS =
  'id, title, notes, status, scheduled_date, original_date, due_date, completed_at, dropped_at, task_areas(area_id)'

export async function fetchTodayTasks(todayISO, startOfTodayISO) {
  const { data, error } = await supabase
    .from('tasks')
    .select(TASK_COLUMNS)
    .is('dropped_at', null)
    .lte('scheduled_date', todayISO)
    .or(`status.neq.done,completed_at.gte."${startOfTodayISO}"`)
    .order('original_date')
    .order('created_at')
  if (error) throw error
  return data.map(taskFromDb)
}

/**
 * Save a task's done / not-done state. `task` is the NEW version.
 * .select() asks for the changed row back: if row-level security blocked
 * the change, no error is raised but no row comes back, so we check.
 */
export async function saveDoneState(task, userId) {
  const done = task.status === 'done'
  const { data, error } = await supabase
    .from('tasks')
    .update({
      status: task.status,
      completed_at: done ? task.completedAt : null,
      completed_by: done ? userId : null,
    })
    .eq('id', task.id)
    .select('id')
  if (error) throw error
  if (!data || data.length === 0) throw new Error('That task could not be updated.')
}

/** One task by id, or null if it doesn't exist (or isn't yours). */
export async function fetchTask(id) {
  const { data, error } = await supabase.from('tasks').select(TASK_COLUMNS).eq('id', id).maybeSingle()
  if (error) throw error
  return data ? taskFromDb(data) : null
}

/**
 * Create or update a task and its areas in one transaction
 * (see supabase/003_save_task.sql). Returns the task id.
 */
export async function saveTask({ id = null, title, notes, scheduledDate, dueDate, areaIds }) {
  const { data, error } = await supabase.rpc('save_task', {
    p_id: id,
    p_title: title,
    p_notes: notes,
    p_scheduled_date: scheduledDate,
    p_due_date: dueDate || null,
    p_area_ids: areaIds,
  })
  if (error) throw error
  return data
}

/** Hide a task from your docket for good. The row stays, stamped with dropped_at. */
export async function dropTask(id) {
  const { data, error } = await supabase
    .from('tasks')
    .update({ dropped_at: new Date().toISOString() })
    .eq('id', id)
    .select('id')
  if (error) throw error
  if (!data || data.length === 0) throw new Error('That task could not be dropped.')
}

/**
 * Apply the Close the day choices in one transaction
 * (see supabase/004_close_day.sql).
 * items: [{ id, action: 'move', date: 'YYYY-MM-DD' } | { id, action: 'drop' }]
 * Returns { moved, dropped }.
 */
export async function closeDay(items) {
  const { data, error } = await supabase.rpc('close_day', { p_items: items })
  if (error) throw error
  return data?.[0] ?? { moved: 0, dropped: 0 }
}

/** Tasks completed since a moment (local midnight N days ago), newest first. */
export async function fetchDoneSince(sinceISO) {
  const { data, error } = await supabase
    .from('tasks')
    .select(TASK_COLUMNS)
    .eq('status', 'done')
    .is('dropped_at', null)
    .gte('completed_at', sinceISO)
    .order('completed_at', { ascending: false })
    .limit(500)
  if (error) throw error
  return data.map(taskFromDb)
}

/** Dropped tasks, most recently dropped first. */
export async function fetchDropped() {
  const { data, error } = await supabase
    .from('tasks')
    .select(TASK_COLUMNS)
    .not('dropped_at', 'is', null)
    .order('dropped_at', { ascending: false })
    .limit(100)
  if (error) throw error
  return data.map(taskFromDb)
}

/** Bring a dropped task back, onto the given day. */
export async function restoreTask(id, dayISO) {
  const { data, error } = await supabase
    .from('tasks')
    .update({ dropped_at: null, scheduled_date: dayISO })
    .eq('id', id)
    .select('id')
  if (error) throw error
  if (!data || data.length === 0) throw new Error('That task could not be restored.')
}

/**
 * Close the day and keep a record so it can be reopened until midnight
 * (see supabase/006_reopen_day.sql). Returns { moved, dropped, closureId }.
 */
export async function closeDayWithRecord(items, closedOnISO, undoItems) {
  const { data, error } = await supabase.rpc('close_day_with_record', {
    p_items: items,
    p_closed_on: closedOnISO,
    p_undo_items: undoItems,
  })
  if (error) throw error
  const row = data?.[0] ?? {}
  return { moved: row.moved ?? 0, dropped: row.dropped ?? 0, closureId: row.closure_id }
}

/** Undo a close: every task goes back where it was. */
export async function reopenDay(closureId) {
  const { error } = await supabase.rpc('reopen_day', { p_closure_id: closureId })
  if (error) throw error
}

/** Today's most recent close that hasn't been reopened, or null. */
export async function fetchOpenClosure(todayISO) {
  const { data, error } = await supabase
    .from('day_closures')
    .select('id, closed_at')
    .eq('closed_on', todayISO)
    .is('reopened_at', null)
    .order('closed_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data ? { id: data.id, closedAt: data.closed_at } : null
}

/** Every task on a docket between two days (inclusive), open or done. */
export async function fetchTasksBetween(fromISO, toISO) {
  const { data, error } = await supabase
    .from('tasks')
    .select(TASK_COLUMNS)
    .is('dropped_at', null)
    .gte('scheduled_date', fromISO)
    .lte('scheduled_date', toISO)
    .order('scheduled_date')
    .order('created_at')
  if (error) throw error
  return data.map(taskFromDb)
}

/**
 * Every open task in one area, with all of its areas.
 * Two steps: find the task ids linked to the area, then load those tasks
 * (asking for them in batches keeps each request's address short).
 */
export async function fetchOpenInArea(areaId) {
  const { data: links, error: linkError } = await supabase
    .from('task_areas')
    .select('task_id')
    .eq('area_id', areaId)
  if (linkError) throw linkError

  const ids = [...new Set(links.map((l) => l.task_id))]
  const tasks = []
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await supabase
      .from('tasks')
      .select(TASK_COLUMNS)
      .in('id', ids.slice(i, i + 100))
      .neq('status', 'done')
      .is('dropped_at', null)
    if (error) throw error
    tasks.push(...data.map(taskFromDb))
  }
  return tasks
}

/** Move tasks to new days in one transaction (supabase/008_reschedule.sql). */
export async function reschedule(items) {
  const { data, error } = await supabase.rpc('reschedule', { p_items: items })
  if (error) throw error
  return data ?? 0
}
