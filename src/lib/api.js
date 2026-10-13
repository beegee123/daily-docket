import { supabase } from './supabase.js'
import { expandAll, nextOccurrence } from './repeat.js'

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
    scheduledDate: row.scheduled_date, // null for a this-week task
    weekOf: row.week_of ?? null, // the Monday of a this-week task
    originalDate: row.original_date,
    dueDate: row.due_date,
    completedAt: row.completed_at,
    droppedAt: row.dropped_at,
    createdBy: row.created_by,
    assignedTo: row.assigned_to,
    completedBy: row.completed_by,
    areaIds: (row.task_areas ?? []).map((link) => link.area_id),
    // "Remind me at" on the task's day: '15:00' or null (supabase/021_reminders.sql)
    remindTime: row.remind_time?.slice(0, 5) ?? null,
    // A copy made by a repeat (supabase/023_repeat_rules.sql), else null
    ruleId: row.rule_id ?? null,
    ruleDate: row.rule_date ?? null,
    rule: row.repeat_rules ? ruleFromDb(row.repeat_rules) : null,
  }
}

function ruleFromDb(row) {
  return {
    id: row.id,
    areaId: row.area_id,
    createdBy: row.created_by,
    assignedTo: row.assigned_to ?? null,
    routineId: row.routine_id ?? null,
    title: row.title ?? null,
    notes: row.notes ?? '',
    remindTime: row.remind_time?.slice(0, 5) ?? null,
    repeat: row.repeat,
    repeatDays: row.repeat_days ?? null,
    startDate: row.start_date,
    repeatUntil: row.repeat_until ?? null,
    ifMissed: row.if_missed,
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
const RULE_COLUMNS =
  'id, area_id, created_by, assigned_to, routine_id, title, notes, remind_time, repeat, repeat_days, start_date, repeat_until, if_missed'

const TASK_COLUMNS =
  'id, title, notes, status, scheduled_date, week_of, original_date, due_date, completed_at, dropped_at, created_by, assigned_to, completed_by, remind_time, rule_id, rule_date, task_areas(area_id), repeat_rules(' +
  RULE_COLUMNS +
  ')'

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
export async function saveTask({
  id = null,
  title,
  notes,
  scheduledDate,
  weekOf = null,
  dueDate,
  areaIds,
  assignedTo = null,
  remindTime,
}) {
  const { data, error } = await supabase.rpc('save_task', {
    p_id: id,
    p_title: title,
    p_notes: notes,
    // A this-week task sends its week and no day (supabase/018_week_tasks.sql)
    p_scheduled_date: weekOf ? null : scheduledDate,
    p_week_of: weekOf || null,
    p_due_date: dueDate || null,
    p_area_ids: areaIds,
    p_assigned_to: assignedTo || null,
  })
  if (error) throw error
  // The reminder time is saved on its own (save_task doesn't know about it).
  // Left out = leave it as it is. A this-week task has no day, so no reminder.
  if (remindTime !== undefined) {
    const { error: remindError } = await supabase
      .from('tasks')
      .update({ remind_time: weekOf ? null : remindTime || null })
      .eq('id', data)
    if (remindError) throw remindError
  }
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
  const { data: links, error: linkError } = await supabase.from('task_areas').select('task_id').eq('area_id', areaId)
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

/**
 * { timezone, digestOn, digestTime: '07:30', digestDays: 'weekdays' | 'every',
 *   meetingReminders: true, remindDefault: 10 }
 */
export async function fetchSettings() {
  const { data, error } = await supabase
    .from('user_settings')
    .select('timezone, digest_on, digest_time, digest_days, meeting_reminders, remind_default')
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  return {
    timezone: data.timezone,
    digestOn: data.digest_on,
    digestTime: data.digest_time.slice(0, 5), // '07:30:00' -> '07:30'
    digestDays: data.digest_days,
    meetingReminders: data.meeting_reminders ?? true,
    remindDefault: data.remind_default ?? 10,
  }
}

/** Save digest and reminder choices. Pass only what changed. */
export async function saveSettings(userId, { digestOn, digestTime, digestDays, meetingReminders, remindDefault }) {
  const row = { user_id: userId, timezone: deviceTimezone() }
  if (digestOn !== undefined) row.digest_on = digestOn
  if (digestTime !== undefined) row.digest_time = digestTime
  if (digestDays !== undefined) row.digest_days = digestDays
  if (meetingReminders !== undefined) row.meeting_reminders = meetingReminders
  if (remindDefault !== undefined) row.remind_default = remindDefault
  const { error } = await supabase.from('user_settings').upsert(row, { onConflict: 'user_id' })
  if (error) throw error
}

// ---------- Managing areas (supabase/011_manage_areas.sql) ----------

/** Turn database errors into something worth reading. */
function areaError(error) {
  if (error?.code === '23505') return new Error('You already have an area with that name.')
  if (error?.code === '23514') return new Error("That colour or name isn't allowed.")
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
  const { data, error } = await supabase.from('areas').update({ name: name.trim(), color }).eq('id', id).select('id')
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
    // '14:00:00' -> '14:00'; null = all day
    startTime: row.start_time?.slice(0, 5) ?? null,
    endTime: row.end_time?.slice(0, 5) ?? null,
    timeZone: row.time_zone,
    remindMinutes: row.remind_minutes ?? null, // null = no reminder
    // Repeating (supabase/022_repeating_events.sql); null = a one-off
    repeat: row.repeat ?? null,
    repeatDays: row.repeat_days ?? null,
    repeatUntil: row.repeat_until ?? null,
    skips: (row.event_skips ?? []).map((s) => s.on_date),
    notes: row.notes,
  }
}

const EVENT_COLUMNS =
  'id, area_id, created_by, person_id, title, start_date, end_date, start_time, end_time, time_zone, remind_minutes, notes, repeat, repeat_days, repeat_until, event_skips(on_date)'

/**
 * Events touching any day from..to (inclusive). A repeating event comes
 * back once for each date it falls on in the range (src/lib/repeat.js).
 */
export async function fetchEventsBetween(fromISO, toISO) {
  const { data, error } = await supabase
    .from('events')
    .select(EVENT_COLUMNS)
    .lte('start_date', toISO)
    // A one-off that hasn't ended, or a series that hasn't stopped
    .or(`end_date.gte.${fromISO},and(repeat.not.is.null,or(repeat_until.is.null,repeat_until.gte.${fromISO}))`)
    .order('start_date')
    .order('start_time', { nullsFirst: true })
  if (error) throw error
  return expandAll(data.map(eventFromDb), fromISO, toISO)
}

/**
 * Everything not over yet, soonest first. A series is listed once, with
 * `nextDate` (its next date from today) to sort and show by.
 */
export async function fetchUpcomingEvents(todayISO) {
  const { data, error } = await supabase
    .from('events')
    .select(EVENT_COLUMNS)
    .or(`end_date.gte.${todayISO},and(repeat.not.is.null,or(repeat_until.is.null,repeat_until.gte.${todayISO}))`)
    .order('start_date')
    .order('start_time', { nullsFirst: true })
    .limit(100)
  if (error) throw error
  return data
    .map(eventFromDb)
    .map((ev) => ({ ...ev, nextDate: ev.repeat ? nextOccurrence(ev, todayISO) : ev.startDate }))
    .filter((ev) => ev.nextDate) // a series with no dates left
    .sort((a, b) => a.nextDate.localeCompare(b.nextDate) || (a.startTime ?? '').localeCompare(b.startTime ?? ''))
}

export async function fetchEvent(id) {
  const { data, error } = await supabase.from('events').select(EVENT_COLUMNS).eq('id', id).maybeSingle()
  if (error) throw error
  return data ? eventFromDb(data) : null
}

export async function saveEvent({
  id = null,
  areaId,
  personId,
  title,
  startDate,
  endDate,
  startTime = null,
  endTime = null,
  timeZone = null,
  remindMinutes = null,
  repeat = null,
  repeatDays = null,
  repeatUntil = null,
  notes,
}) {
  const row = {
    area_id: areaId,
    person_id: personId || null,
    title: title.trim(),
    start_date: startDate,
    end_date: endDate,
    start_time: startTime || null,
    end_time: (startTime && endTime) || null,
    // Where the time was entered; kept when someone elsewhere edits it
    time_zone: timeZone || deviceTimezone(),
    // Only meetings with a time can have a reminder
    remind_minutes: startTime ? remindMinutes : null,
    // Only a one-day event (not a trip) can repeat
    repeat: !personId && startDate === endDate ? repeat || null : null,
    repeat_days: repeat === 'weekly' || repeat === 'biweekly' ? repeatDays : null,
    repeat_until: repeat ? repeatUntil || null : null,
    notes: notes?.trim() || null,
  }
  const { data, error } = id
    ? await supabase.from('events').update(row).eq('id', id).select('id')
    : await supabase.from('events').insert(row).select('id')
  if (error) {
    if (error.message?.includes('events_times_in_order'))
      throw new Error('The end time has to be after the start time.')
    if (error.message?.includes('events_repeat_allowed'))
      throw new Error('Check the repeat: pick at least one day, and an until date after the start.')
    if (error.code === '23514') throw new Error("The end date can't be before the start date.")
    throw error
  }
  if (!data?.length) throw new Error('That trip or event could not be saved.')
  return data[0].id
}

export async function deleteEvent(id) {
  const { data, error } = await supabase.from('events').delete().eq('id', id).select('id')
  if (error) throw error
  if (!data?.length) throw new Error('That trip or event could not be deleted.')
}

// ---------- Calendar feed (supabase/015_calendar_feed.sql) ----------

/** Your private calendar token. Made the first time you ask. */
export async function fetchCalendarToken() {
  const { data, error } = await supabase.rpc('my_calendar_token')
  if (error) throw error
  return data
}

/** A new token; calendars on the old link stop updating. */
export async function resetCalendarToken() {
  const { data, error } = await supabase.rpc('reset_calendar_token')
  if (error) throw error
  return data
}

// ---------- This-week tasks (supabase/018_week_tasks.sql) ----------

/**
 * This-week tasks up to a given week: everything still open, plus anything
 * finished since the start of this week. src/lib/week.js picks out which
 * belong to the week on screen.
 */
export async function fetchWeekTasks(upToWeek, sinceISO) {
  const { data, error } = await supabase
    .from('tasks')
    .select(TASK_COLUMNS)
    .not('week_of', 'is', null)
    .is('dropped_at', null)
    .lte('week_of', upToWeek)
    .or(`status.neq.done,completed_at.gte."${sinceISO}"`)
    .order('week_of')
  if (error) throw error
  return data.map(taskFromDb)
}

/** "Do today": a this-week task becomes a normal task on that day (its week is cleared). */
export async function moveToDay(taskId, dayISO) {
  const { data, error } = await supabase
    .from('tasks')
    .update({ scheduled_date: dayISO, original_date: dayISO })
    .eq('id', taskId)
    .select('id')
  if (error) throw error
  if (!data?.length) throw new Error('That task could not be moved.')
}

/** Save a task's notes only: used when ticking a subtask in the week panel. */
export async function saveNotes(taskId, notes) {
  const { data, error } = await supabase
    .from('tasks')
    .update({ notes: notes.trim() ? notes : null })
    .eq('id', taskId)
    .select('id')
  if (error) throw error
  if (!data?.length) throw new Error('That task could not be updated.')
}

// ---------- Routines (supabase/019_routines.sql) ----------

function routineFromDb(row) {
  return {
    id: row.id,
    areaId: row.area_id,
    createdBy: row.created_by,
    name: row.name,
    steps: row.steps ?? [],
    timesUsed: row.times_used ?? 0,
  }
}

const ROUTINE_COLUMNS = 'id, area_id, created_by, name, steps, times_used'

/** Every routine in areas you can see, A to Z. */
export async function fetchRoutines() {
  const { data, error } = await supabase.from('routines').select(ROUTINE_COLUMNS).order('name')
  if (error) throw error
  return data.map(routineFromDb)
}

export async function fetchRoutine(id) {
  const { data, error } = await supabase.from('routines').select(ROUTINE_COLUMNS).eq('id', id).maybeSingle()
  if (error) throw error
  return data ? routineFromDb(data) : null
}

export async function saveRoutine({ id = null, areaId, name, steps }) {
  const row = { area_id: areaId, name: name.trim(), steps }
  const { data, error } = id
    ? await supabase.from('routines').update(row).eq('id', id).select('id')
    : await supabase.from('routines').insert(row).select('id')
  if (error) throw error
  if (!data?.length) throw new Error('That routine could not be saved.')
  return data[0].id
}

export async function deleteRoutine(id) {
  const { data, error } = await supabase.from('routines').delete().eq('id', id).select('id')
  if (error) throw error
  if (!data?.length) throw new Error('That routine could not be deleted.')
}

/**
 * Start a routine (supabase/020_start_routine.sql): one task named after
 * it, with its steps as a checklist, on a day or in a week. Returns the task id.
 */
export async function startRoutine(routineId, { day = null, week = null }) {
  const { data, error } = await supabase.rpc('start_routine', { p_routine: routineId, p_day: day, p_week: week })
  if (error) throw error
  return data
}

// ---------- Attended meetings (supabase/021_reminders.sql) ----------

/**
 * Which meeting dates you've ticked as attended, as a Set of
 * 'eventId@YYYY-MM-DD' (occurrenceKey in src/lib/repeat.js).
 */
export async function fetchAttended(eventIds) {
  if (!eventIds.length) return new Set()
  const { data, error } = await supabase
    .from('event_attendance')
    .select('event_id, on_date')
    .in('event_id', [...new Set(eventIds)])
  if (error) throw error
  return new Set(data.map((row) => `${row.event_id}@${row.on_date}`))
}

/** Tick or untick one date of a meeting as attended (for you only). */
export async function setAttended(eventId, onDate, attended) {
  const { error } = attended
    ? await supabase
        .from('event_attendance')
        .upsert(
          { event_id: eventId, on_date: onDate },
          { onConflict: 'event_id,user_id,on_date', ignoreDuplicates: true },
        )
    : await supabase.from('event_attendance').delete().eq('event_id', eventId).eq('on_date', onDate)
  if (error) throw error
}

// ---------- One date of a repeating event (supabase/022_repeating_events.sql) ----------

/** "Not this time": leave one date out of a series. */
export async function skipOccurrence(eventId, onDate) {
  const { error } = await supabase
    .from('event_skips')
    .upsert({ event_id: eventId, on_date: onDate }, { onConflict: 'event_id,on_date', ignoreDuplicates: true })
  if (error) throw error
}

/** "Just this one": that date becomes its own event. Returns the new event's id. */
export async function detachOccurrence(eventId, onDate) {
  const { data, error } = await supabase.rpc('detach_occurrence', { p_event: eventId, p_date: onDate })
  if (error) throw error
  return data
}

/** "This and later ones": a new series from that date. Returns its id (the same id from the first date). */
export async function splitSeries(eventId, onDate) {
  const { data, error } = await supabase.rpc('split_series', { p_event: eventId, p_date: onDate })
  if (error) throw error
  return data
}

/** "Delete this and later ones": the series stops the day before (or goes, from its first date). */
export async function endSeries(eventId, onDate) {
  const { error } = await supabase.rpc('end_series', { p_event: eventId, p_date: onDate })
  if (error) throw error
}

// ---------- Repeating tasks and routines (supabase/023_repeat_rules.sql) ----------

/** Every repeat in areas you can see. */
export async function fetchRepeatRules() {
  const { data, error } = await supabase.from('repeat_rules').select(RULE_COLUMNS).order('created_at')
  if (error) throw error
  return data.map(ruleFromDb)
}

export async function fetchRepeatRule(id) {
  const { data, error } = await supabase.from('repeat_rules').select(RULE_COLUMNS).eq('id', id).maybeSingle()
  if (error) throw error
  return data ? ruleFromDb(data) : null
}

/** A routine's repeat, or null. */
export async function fetchRoutineRule(routineId) {
  const { data, error } = await supabase
    .from('repeat_rules')
    .select(RULE_COLUMNS)
    .eq('routine_id', routineId)
    .maybeSingle()
  if (error) throw error
  return data ? ruleFromDb(data) : null
}

/** Add or change a repeat. Give routineId for a routine, or title (and notes) for a task. Returns its id. */
export async function saveRepeatRule({
  id = null,
  areaId,
  assignedTo = null,
  routineId = null,
  title = null,
  notes = null,
  remindTime = null,
  repeat,
  repeatDays = null,
  startDate,
  repeatUntil = null,
  ifMissed,
}) {
  const row = {
    area_id: areaId,
    assigned_to: assignedTo || null,
    routine_id: routineId,
    title: routineId ? null : title.trim(),
    notes: routineId ? null : notes?.trim() || null,
    remind_time: remindTime || null,
    repeat,
    repeat_days: repeat === 'weekly' || repeat === 'biweekly' ? repeatDays : null,
    start_date: startDate,
    repeat_until: repeatUntil || null,
    if_missed: ifMissed,
  }
  const { data, error } = id
    ? await supabase.from('repeat_rules').update(row).eq('id', id).select('id')
    : await supabase.from('repeat_rules').insert(row).select('id')
  if (error) {
    if (error.message?.includes('repeat_rules_days')) throw new Error('Pick at least one day for it to repeat on.')
    if (error.message?.includes('repeat_rules_until')) throw new Error('The until date has to be after the start.')
    throw error
  }
  if (!data?.length) throw new Error('That repeat could not be saved.')
  return data[0].id
}

/** Stop repeating. Copies already on your docket stay. */
export async function deleteRepeatRule(id) {
  const { error } = await supabase.from('repeat_rules').delete().eq('id', id)
  if (error) throw error
}

/** Make an existing task the first copy of a repeat (when you turn on Repeats while editing it). */
export async function linkTaskToRule(taskId, ruleId, ruleDate) {
  const { error } = await supabase.from('tasks').update({ rule_id: ruleId, rule_date: ruleDate }).eq('id', taskId)
  if (error) throw error
}

/**
 * Make today's copies of anything that repeats (the schedule does this just
 * after midnight; the app does it too when it opens, as a backup).
 * Returns how many were added.
 */
export async function makeMyRepeats(todayISO) {
  const { data, error } = await supabase.rpc('make_my_repeats', { p_today: todayISO })
  if (error) throw error
  return data
}
