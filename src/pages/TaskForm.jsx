import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router'
import NotesEditor from '../components/NotesEditor.jsx'
import { dropTask, fetchTask, saveTask } from '../lib/api.js'
import { dayParts, daysBetween, daysFromToday, formatShortDate, startOfWeekISO, toLocalISODate } from '../lib/dates.js'
import { nameFor, usePeople } from '../lib/people.js'
import { parsePastedList, weeksCarried } from '../lib/week.js'

/**
 * Add a task (/task/new) or edit one (/task/:id).
 * Every input is "controlled": its value lives in `form` state and each
 * keystroke updates that state, so the form is always the source of truth.
 */
export default function TaskForm({ areas, onSaved, announce }) {
  const { id } = useParams() // undefined on /task/new
  const isNew = !id
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const location = useLocation()
  const { meId, people, areaPeople } = usePeople()
  // Back to wherever the form was opened from (Today, a day on the Week
  // screen...). If the form was opened directly, fall back to Today.
  const goBack = () => (location.key !== 'default' ? navigate(-1) : navigate('/'))

  const todayISO = toLocalISODate()
  const tomorrowISO = daysFromToday(1)
  const thisWeek = startOfWeekISO(todayISO)

  const [form, setForm] = useState(null) // null while an existing task loads
  const [loadError, setLoadError] = useState(null)
  const [saveError, setSaveError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [pickingDay, setPickingDay] = useState(false)
  // "Save and add another": how many tasks added without leaving the form
  const [addedCount, setAddedCount] = useState(0)
  // "Paste a list": many tasks at once, one per line (new tasks only)
  const [pasting, setPasting] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const titleRef = useRef(null)

  // Fill the form: blank for a new task, or from the database for an edit
  useEffect(() => {
    if (isNew) {
      // Opened from the This week panel: start in that week (and its area)
      const week = searchParams.get('week')
      const area = searchParams.get('area')
      setForm({
        title: searchParams.get('title') ?? '',
        notes: '',
        areaIds: area && areas.some((a) => a.id === area) ? [area] : [],
        weekOf: week && startOfWeekISO(week) >= thisWeek ? startOfWeekISO(week) : null,
        // Opened from a day on the Week screen: start on that day
        scheduledDate:
          searchParams.get('date') && searchParams.get('date') >= todayISO ? searchParams.get('date') : todayISO,
        dueDate: '',
        assignedTo: null,
        originalDate: null,
      })
      return
    }

    let cancelled = false
    fetchTask(id)
      .then((task) => {
        if (cancelled) return
        if (!task) {
          setLoadError('This task no longer exists.')
          return
        }
        setForm({
          title: task.title,
          notes: task.notes ?? '',
          areaIds: task.areaIds,
          scheduledDate: task.scheduledDate ?? todayISO,
          weekOf: task.weekOf,
          dueDate: task.dueDate ?? '',
          assignedTo: task.assignedTo ?? null,
          originalDate: task.originalDate,
        })
      })
      .catch((e) => !cancelled && setLoadError(e.message))
    return () => {
      cancelled = true
    }
    // Only re-run when the task id in the address changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  // Change one field, keep the rest
  const update = (field, value) => setForm((prev) => ({ ...prev, [field]: value }))

  function toggleArea(areaId) {
    setForm((prev) => ({
      ...prev,
      areaIds: prev.areaIds.includes(areaId)
        ? prev.areaIds.filter((a) => a !== areaId)
        : [...prev.areaIds, areaId],
    }))
  }

  // Checks we can make before bothering the database
  function problem() {
    if (pasting) {
      if (parsePastedList(pasteText).length === 0) return 'Paste or type at least one line.'
    } else if (!form.title.trim()) return 'Give the task a title.'
    if (form.areaIds.length === 0) return 'Pick at least one area.'
    if (!form.weekOf && !form.scheduledDate) return 'Pick a day for this task.'
    return null
  }

  // `another`: stay on the form, keep the areas and day, clear the rest.
  // Once you've used "Save and add another", pressing Enter keeps adding.
  async function handleSave(e, { another = isNew && addedCount > 0 } = {}) {
    e.preventDefault()
    const issue = problem()
    if (issue) {
      setSaveError(issue)
      return
    }
    setBusy(true)
    setSaveError(null)
    if (pasting) return savePasted()
    try {
      await saveTask({
        id: id ?? null,
        title: form.title,
        notes: form.notes,
        scheduledDate: form.scheduledDate,
        weekOf: form.weekOf,
        dueDate: form.dueDate,
        areaIds: form.areaIds,
        assignedTo: assignee,
      })
      onSaved()
      if (another) {
        announce(`Added: ${form.title.trim()}`)
        setAddedCount((n) => n + 1)
        setForm((prev) => ({ ...prev, title: '', notes: '', dueDate: '' }))
        setBusy(false)
        titleRef.current?.focus()
        return
      }
      goBack()
    } catch (err) {
      setSaveError(err.message)
      setBusy(false)
    }
  }

  // One task per pasted line, all with the same areas and day or week
  async function savePasted() {
    const items = parsePastedList(pasteText)
    let added = 0
    try {
      for (const item of items) {
        await saveTask({
          title: item.title,
          notes: item.notes,
          scheduledDate: form.scheduledDate,
          weekOf: form.weekOf,
          dueDate: form.dueDate,
          areaIds: form.areaIds,
          assignedTo: assignee,
        })
        added++
      }
      onSaved()
      announce(`Added ${added} ${added === 1 ? 'task' : 'tasks'}`)
      goBack()
    } catch (err) {
      onSaved()
      // Keep only the lines that didn't make it, so Save can simply be tapped again
      const rest = items.slice(added).map((t) => [t.title, ...(t.notes ? t.notes.split('\n').map((l) => `  ${l}`) : [])].join('\n'))
      setPasteText(rest.join('\n'))
      setSaveError(added ? `Added ${added} of ${items.length}. The rest are still below. ${err.message}` : err.message)
      setBusy(false)
    }
  }

  async function handleDrop() {
    if (!window.confirm('Drop this task? It will disappear from your docket.')) return
    setBusy(true)
    try {
      await dropTask(id)
      onSaved()
      goBack()
    } catch (err) {
      setSaveError(err.message)
      setBusy(false)
    }
  }

  if (loadError) {
    return (
      <div className="screen status-screen" role="alert">
        <h1>Task not found</h1>
        <p>{loadError}</p>
        <Link to="/" className="btn-primary as-link">Back to today</Link>
      </div>
    )
  }

  if (!form) {
    return (
      <div className="screen status-screen" role="status">
        <h1>Loading…</h1>
      </div>
    )
  }

  // Who can this task be assigned to? Everyone in its shared areas.
  // Only offered when one of the chosen areas is shared.
  const eligible = [...new Set(form.areaIds.flatMap((id) => areaPeople[id] ?? []))]
  const canAssign = eligible.length > 1
  // If the areas change and the assignee isn't in them any more, drop it
  const assignee = canAssign && eligible.includes(form.assignedTo) ? form.assignedTo : null

  // Which "On my docket" chip is lit
  const day = form.weekOf
    ? 'week'
    : form.scheduledDate === todayISO
      ? 'today'
      : form.scheduledDate === tomorrowISO
        ? 'tomorrow'
        : 'pick'
  const showPicker = pickingDay || day === 'pick'
  // A task rolled over from an earlier week is in this week now
  const weekLabel =
    !form.weekOf || form.weekOf <= thisWeek
      ? 'This week'
      : `Week of ${dayParts(form.weekOf).day} ${dayParts(form.weekOf).month}`
  const weeksRolled = form.weekOf && !isNew ? weeksCarried({ weekOf: form.weekOf }, thisWeek) : 0
  // Pick a day / Today / Tomorrow: the task leaves its week
  const setDay = (iso) => setForm((prev) => ({ ...prev, scheduledDate: iso, weekOf: null }))
  const pasted = pasting ? parsePastedList(pasteText) : []

  const daysCarried = form.originalDate && !form.weekOf ? daysBetween(form.originalDate, todayISO) : 0

  return (
    <form className="screen task-form" onSubmit={handleSave} noValidate>
      <header className="form-header">
        <button type="button" className="text-btn" onClick={goBack}>
          {addedCount > 0 ? 'Done' : 'Cancel'}
        </button>
        <h1 className="form-heading">{isNew ? 'New task' : 'Edit task'}</h1>
        {addedCount > 0 && !form.title.trim() ? (
          <button type="button" className="btn-dark" onClick={goBack}>Done</button>
        ) : (
          <button type="button" className="btn-dark" disabled={busy} onClick={(e) => handleSave(e, { another: false })}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        )}
      </header>

      <div className="form-body">
        {pasting ? (
          <label className="field">
            <span className="field-caps">TASKS · ONE PER LINE</span>
            <textarea
              className="box-input paste-input"
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder={'Sandbox refresh\nAN\n  - Pull requirements\n  - Draft mapping\nDevops pipeline'}
              autoFocus
            />
            <span className="hint">
              Bullets and checkboxes are removed. Indented lines become steps (a checklist) of the line above.
            </span>
            {pasted.length > 0 && (
              <>
                <span className="hint">
                  Adds {pasted.length} {pasted.length === 1 ? 'task' : 'tasks'}:
                </span>
                <ul className="paste-preview">
                  {pasted.map((t, i) => {
                    const steps = t.notes ? t.notes.split('\n').length : 0
                    return (
                      <li key={i}>
                        {t.title}
                        {steps > 0 && ` · ${steps} ${steps === 1 ? 'step' : 'steps'}`}
                      </li>
                    )
                  })}
                </ul>
              </>
            )}
          </label>
        ) : (
          <label className="field">
            <span className="field-caps">TASK</span>
            <input
              ref={titleRef}
              className="title-input"
              value={form.title}
              onChange={(e) => update('title', e.target.value)}
              placeholder="What needs doing?"
              maxLength={200}
              autoFocus={isNew}
            />
          </label>
        )}
        {isNew && addedCount === 0 && (
          <button type="button" className="text-btn small-link" onClick={() => setPasting((v) => !v)}>
            {pasting ? 'Add just one task' : 'Paste a list instead'}
          </button>
        )}

        <fieldset className="field">
          <legend className="field-caps">AREAS · PICK ONE OR MORE</legend>
          <div className="chip-row">
            {areas.map((area) => {
              const on = form.areaIds.includes(area.id)
              return (
                <button
                  type="button"
                  key={area.id}
                  className={`chip chip-lg${on ? ' is-on' : ''}`}
                  aria-pressed={on}
                  onClick={() => toggleArea(area.id)}
                >
                  <span className="dot" style={{ background: on ? '#FFFFFF' : area.color }} />
                  {area.name}
                </button>
              )
            })}
          </div>
        </fieldset>

        <fieldset className="field">
          <legend className="field-caps">ON MY DOCKET</legend>
          <div className="chip-row">
            <button
              type="button"
              className={`chip chip-lg${day === 'today' && !pickingDay ? ' is-on' : ''}`}
              aria-pressed={day === 'today' && !pickingDay}
              onClick={() => {
                setPickingDay(false)
                setDay(todayISO)
              }}
            >
              Today
            </button>
            <button
              type="button"
              className={`chip chip-lg${day === 'tomorrow' && !pickingDay ? ' is-on' : ''}`}
              aria-pressed={day === 'tomorrow' && !pickingDay}
              onClick={() => {
                setPickingDay(false)
                setDay(tomorrowISO)
              }}
            >
              Tomorrow
            </button>
            <button
              type="button"
              className={`chip chip-lg${day === 'week' && !pickingDay ? ' is-on' : ''}`}
              aria-pressed={day === 'week' && !pickingDay}
              onClick={() => {
                setPickingDay(false)
                setForm((prev) => ({ ...prev, weekOf: prev.weekOf ?? thisWeek }))
              }}
            >
              {weekLabel}
            </button>
            <button
              type="button"
              className={`chip chip-lg${showPicker && day !== 'week' ? ' is-on' : ''}`}
              aria-pressed={showPicker && day !== 'week'}
              onClick={() => {
                setPickingDay(true)
                if (form.weekOf) setDay(form.scheduledDate < todayISO ? todayISO : form.scheduledDate)
              }}
            >
              {day === 'pick' ? formatShortDate(form.scheduledDate, todayISO) : 'Pick a day'}
            </button>
          </div>
          {showPicker && (
            <label className="field inline-field">
              <span className="visually-hidden">Day</span>
              <input
                type="date"
                className="box-input"
                value={form.scheduledDate}
                onChange={(e) => setDay(e.target.value)}
              />
            </label>
          )}
          {day === 'week' && (
            <span className="hint">
              No set day: it stays on the Week screen until done, and moves to next week if unfinished.
              {weeksRolled > 0 && ` Carried over ${weeksRolled} ${weeksRolled === 1 ? 'week' : 'weeks'}.`}
            </span>
          )}
          {!isNew && daysCarried > 0 && (
            <span className="hint">
              First on your docket {formatShortDate(form.originalDate, todayISO)} · carried over{' '}
              {daysCarried} {daysCarried === 1 ? 'day' : 'days'}
            </span>
          )}
        </fieldset>

        {canAssign && (
          <fieldset className="field">
            <legend className="field-caps">ASSIGNED TO</legend>
            <div className="chip-row">
              <button
                type="button"
                className={`chip chip-lg${assignee === null ? ' is-on' : ''}`}
                aria-pressed={assignee === null}
                onClick={() => update('assignedTo', null)}
              >
                Anyone
              </button>
              {[meId, ...eligible.filter((id) => id !== meId)].map((id) => (
                <button
                  key={id}
                  type="button"
                  className={`chip chip-lg${assignee === id ? ' is-on' : ''}`}
                  aria-pressed={assignee === id}
                  onClick={() => update('assignedTo', id)}
                >
                  {nameFor(id, meId, people)}
                </button>
              ))}
            </div>
          </fieldset>
        )}

        <label className="field">
          <span className="field-caps">DUE DATE · OPTIONAL</span>
          <div className="due-row">
            <input
              type="date"
              className="box-input"
              value={form.dueDate}
              onChange={(e) => update('dueDate', e.target.value)}
            />
            {form.dueDate && (
              <button type="button" className="text-btn" onClick={() => update('dueDate', '')}>
                Clear
              </button>
            )}
          </div>
        </label>

        {!pasting && <NotesEditor id="task-notes" value={form.notes} onChange={(v) => update('notes', v)} />}

        {saveError && (
          <p className="form-error" role="alert">
            {saveError}
          </p>
        )}

        {isNew && !pasting && (
          <div className="add-another">
            <button
              type="button"
              className="btn-secondary"
              disabled={busy}
              onClick={(e) => handleSave(e, { another: true })}
            >
              Save and add another
            </button>
            {addedCount > 0 && (
              <span className="hint">
                {addedCount} added so far · areas and {form.weekOf ? 'week' : 'day'} stay the same · Enter adds the next one
              </span>
            )}
          </div>
        )}

        {!isNew && (
          <button type="button" className="danger-btn" onClick={handleDrop} disabled={busy}>
            Drop this task
          </button>
        )}
      </div>
    </form>
  )
}
