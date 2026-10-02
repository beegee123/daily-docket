import { supabase } from './supabase.js'

// Every call to the database lives here, so screens never talk to
// Supabase directly. Row-level security quietly limits every query to
// what the signed-in person may see (their own rows, plus areas shared
// with them); nothing here filters by user.

// The database says scheduled_date; JavaScript code says scheduledDate.
// These two translators are the only place that difference exists.
function areaFromDb(row) {
  return { id: row.id, name: row.name, color: row.color, sortOrder: row.sort_order, ownerId: row.owner_id }
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
    createdBy: row.created_by,
    assignedTo: row.assigned_to,
    completedBy: row.completed_by,
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
    .select('id, name, color, sort_order, owner_id')
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
  'id, title, notes, status, scheduled_date, original_date, due_date, completed_at, dropped_at, created_by, assigned_to, completed_by, task_areas(area_id)'

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
export async function saveTask({ id = null, title, notes, scheduledDate, dueDate, areaIds, assignedTo = null }) {
  const { data, error } = await supabase.rpc('save_task', {
    p_id: id,
    p_title: title,
    p_notes: notes,
    p_scheduled_date: scheduledDate,
    p_due_date: dueDate || null,
    p_area_ids: areaIds,
    p_assigned_to: assignedTo || null,
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

// ---------- Morning digest settings (supabase/009_digest.sql) ----------

/** The timezone this device is in, e.g. 'America/New_York'. */
export function deviceTimezone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York'
}

/**
 * Make sure a settings row exists and its timezone matches this device.
 * Only the timezone is sent, so existing digest choices are left alone.
 */
export async function syncTimezone(userId) {
  const { error } = await supabase
    .from('user_settings')
    .upsert({ user_id: userId, timezone: deviceTimezone() }, { onConflict: 'user_id' })
  if (error) throw error
}

/** { timezone, digestOn, digestTime: '07:30', digestDays: 'weekdays' | 'every' } */
export async function fetchSettings() {
  const { data, error } = await supabase
    .from('user_settings')
    .select('timezone, digest_on, digest_time, digest_days')
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  return {
    timezone: data.timezone,
    digestOn: data.digest_on,
    digestTime: data.digest_time.slice(0, 5), // '07:30:00' -> '07:30'
    digestDays: data.digest_days,
  }
}

/** Save digest choices. Pass only what changed. */
export async function saveSettings(userId, { digestOn, digestTime, digestDays }) {
  const row = { user_id: userId, timezone: deviceTimezone() }
  if (digestOn !== undefined) row.digest_on = digestOn
  if (digestTime !== undefined) row.digest_time = digestTime
  if (digestDays !== undefined) row.digest_days = digestDays
  const { error } = await supabase.from('user_settings').upsert(row, { onConflict: 'user_id' })
  if (error) throw error
}

// ---------- Managing areas (supabase/011_manage_areas.sql) ----------

/** Turn database errors into something worth reading. */
function areaError(error) {
  if (error?.code === '23505') return new Error('You already have an area with that name.')
  if (error?.code === '23514') return new Error('That colour or name isn\'t allowed.')
  return error
}

/** { [areaId]: { open, total } } — how many tasks each area has. */
export async function fetchAreaCounts() {
  const { data, error } = await supabase.from('task_areas').select('area_id, tasks!inner(status, dropped_at)')
  if (error) throw error
  const counts = {}
  for (const row of data) {
    const c = (counts[row.area_id] ??= { open: 0, total: 0 })
    c.total++
    if (row.tasks.status !== 'done' && !row.tasks.dropped_at) c.open++
  }
  return counts
}

export async function createArea({ name, color, sortOrder }) {
  const { error } = await supabase.from('areas').insert({ name: name.trim(), color, sort_order: sortOrder })
  if (error) throw areaError(error)
}

export async function updateArea(id, { name, color }) {
  const { data, error } = await supabase
    .from('areas')
    .update({ name: name.trim(), color })
    .eq('id', id)
    .select('id')
  if (error) throw areaError(error)
  if (!data?.length) throw new Error('That area no longer exists.')
}

/** Move the area's tasks to another area, then delete it. Returns tasks moved. */
export async function deleteArea(id, moveToId) {
  const { data, error } = await supabase.rpc('delete_area', { p_area: id, p_move_to: moveToId ?? null })
  if (error) throw error
  return data ?? 0
}

export async function reorderAreas(ids) {
  const { error } = await supabase.rpc('reorder_areas', { p_ids: ids })
  if (error) throw error
}

// ---------- Sharing areas (supabase/012_share_areas.sql) ----------

/** Join any areas waiting for my email. Returns how many I joined. */
export async function acceptMyInvites() {
  const { data, error } = await supabase.rpc('accept_my_invites')
  if (error) throw error
  return data ?? 0
}

/** { [userId]: email } for everyone I share an area with. */
export async function fetchPeople() {
  const { data, error } = await supabase.rpc('my_people')
  if (error) throw error
  return Object.fromEntries((data ?? []).map((p) => [p.user_id, p.email]))
}

/** Invites and members of every area I can see. */
export async function fetchMembers() {
  const { data, error } = await supabase
    .from('area_members')
    .select('id, area_id, invited_email, user_id, accepted_at')
    .order('created_at')
  if (error) throw error
  return data.map((m) => ({
    id: m.id,
    areaId: m.area_id,
    email: m.invited_email,
    userId: m.user_id,
    joined: Boolean(m.user_id),
  }))
}

export async function inviteToArea(areaId, email) {
  const { error } = await supabase.rpc('invite_to_area', { p_area: areaId, p_email: email })
  if (error) throw error
}

/** Owner removes an invite or member. */
export async function removeMember(memberId) {
  const { error } = await supabase.from('area_members').delete().eq('id', memberId)
  if (error) throw error
}

/** Member leaves an area someone shared with them. */
export async function leaveArea(areaId, userId) {
  const { data, error } = await supabase
    .from('area_members')
    .delete()
    .eq('area_id', areaId)
    .eq('user_id', userId)
    .select('id')
  if (error) throw error
  if (!data?.length) throw new Error("Couldn't leave that area.")
}

// ---------- Trips and events (supabase/014_events.sql) ----------

function eventFromDb(row) {
  return {
    id: row.id,
    areaId: row.area_id,
    createdBy: row.created_by,
    personId: row.person_id,
    title: row.title,
    startDate: row.start_date,
    endDate: row.end_date,
    notes: row.notes,
  }
}

const EVENT_COLUMNS = 'id, area_id, created_by, person_id, title, start_date, end_date, notes'

/** Events touching any day from..to (inclusive). */
export async function fetchEventsBetween(fromISO, toISO) {
  const { data, error } = await supabase
    .from('events')
    .select(EVENT_COLUMNS)
    .lte('start_date', toISO)
    .gte('end_date', fromISO)
    .order('start_date')
  if (error) throw error
  return data.map(eventFromDb)
}

/** Everything not over yet, soonest first. */
export async function fetchUpcomingEvents(todayISO) {
  const { data, error } = await supabase
    .from('events')
    .select(EVENT_COLUMNS)
    .gte('end_date', todayISO)
    .order('start_date')
    .limit(100)
  if (error) throw error
  return data.map(eventFromDb)
}

export async function fetchEvent(id) {
  const { data, error } = await supabase.from('events').select(EVENT_COLUMNS).eq('id', id).maybeSingle()
  if (error) throw error
  return data ? eventFromDb(data) : null
}

export async function saveEvent({ id = null, areaId, personId, title, startDate, endDate, notes }) {
  const row = {
    area_id: areaId,
    person_id: personId || null,
    title: title.trim(),
    start_date: startDate,
    end_date: endDate,
    notes: notes?.trim() || null,
  }
  const { data, error } = id
    ? await supabase.from('events').update(row).eq('id', id).select('id')
    : await supabase.from('events').insert(row).select('id')
  if (error) {
    if (error.code === '23514') throw new Error('The end date can\'t be before the start date.')
    throw error
  }
  if (!data?.length) throw new Error('That trip or event could not be saved.')
}

export async function deleteEvent(id) {
  const { data, error } = await supabase.from('events').delete().eq('id', id).select('id')
  if (error) throw error
  if (!data?.length) throw new Error('That trip or event could not be deleted.')
}
