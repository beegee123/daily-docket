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
export async function fetchTodayTasks(todayISO, startOfTodayISO) {
  const { data, error } = await supabase
    .from('tasks')
    .select(
      'id, title, notes, status, scheduled_date, original_date, due_date, completed_at, dropped_at, task_areas(area_id)',
    )
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
