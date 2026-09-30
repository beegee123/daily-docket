import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router'
import { dropTask, fetchTask, saveTask } from '../lib/api.js'
import { daysBetween, daysFromToday, formatShortDate, toLocalISODate } from '../lib/dates.js'

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
  // Back to wherever the form was opened from (Today, a day on the Week
  // screen...). If the form was opened directly, fall back to Today.
  const goBack = () => (location.key !== 'default' ? navigate(-1) : navigate('/'))

  const todayISO = toLocalISODate()
  const tomorrowISO = daysFromToday(1)

  const [form, setForm] = useState(null) // null while an existing task loads
  const [loadError, setLoadError] = useState(null)
  const [saveError, setSaveError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [pickingDay, setPickingDay] = useState(false)
  // "Save and add another": how many tasks added without leaving the form
  const [addedCount, setAddedCount] = useState(0)
  const titleRef = useRef(null)

  // Fill the form: blank for a new task, or from the database for an edit
  useEffect(() => {
    if (isNew) {
      setForm({
        title: searchParams.get('title') ?? '',
        notes: '',
        areaIds: [],
        // Opened from a day on the Week screen: start on that day
        scheduledDate:
          searchParams.get('date') && searchParams.get('date') >= todayISO ? searchParams.get('date') : todayISO,
        dueDate: '',
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
          scheduledDate: task.scheduledDate,
          dueDate: task.dueDate ?? '',
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
    if (!form.title.trim()) return 'Give the task a title.'
    if (form.areaIds.length === 0) return 'Pick at least one area.'
    if (!form.scheduledDate) return 'Pick a day for this task.'
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
    try {
      await saveTask({
        id: id ?? null,
        title: form.title,
        notes: form.notes,
        scheduledDate: form.scheduledDate,
        dueDate: form.dueDate,
        areaIds: form.areaIds,
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

  // Which "On my docket" chip is lit
  const day =
    form.scheduledDate === todayISO ? 'today' : form.scheduledDate === tomorrowISO ? 'tomorrow' : 'pick'
  const showPicker = pickingDay || day === 'pick'

  const daysCarried = form.originalDate ? daysBetween(form.originalDate, todayISO) : 0

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
                update('scheduledDate', todayISO)
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
                update('scheduledDate', tomorrowISO)
              }}
            >
              Tomorrow
            </button>
            <button
              type="button"
              className={`chip chip-lg${showPicker ? ' is-on' : ''}`}
              aria-pressed={showPicker}
              onClick={() => setPickingDay(true)}
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
                onChange={(e) => update('scheduledDate', e.target.value)}
              />
            </label>
          )}
          {!isNew && daysCarried > 0 && (
            <span className="hint">
              First on your docket {formatShortDate(form.originalDate, todayISO)} · carried over{' '}
              {daysCarried} {daysCarried === 1 ? 'day' : 'days'}
            </span>
          )}
        </fieldset>

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

        <label className="field">
          <span className="field-caps">NOTES</span>
          <textarea
            className="notes-input"
            value={form.notes}
            onChange={(e) => update('notes', e.target.value)}
            rows={3}
          />
        </label>

        {saveError && (
          <p className="form-error" role="alert">
            {saveError}
          </p>
        )}

        {isNew && (
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
                {addedCount} added so far · areas and day stay the same · Enter adds the next one
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
