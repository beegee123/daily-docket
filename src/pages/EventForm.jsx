import { useEffect, useState } from 'react'
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router'
import NotesEditor from '../components/NotesEditor.jsx'
import { deleteEvent, fetchEvent, saveEvent } from '../lib/api.js'
import { toLocalISODate } from '../lib/dates.js'
import { isShared, nameFor, usePeople } from '../lib/people.js'

/** Add (/events/new) or edit (/events/:id) a trip or event. */
export default function EventForm({ areas, onSaved, announce }) {
  const { id } = useParams()
  const isNew = !id
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const location = useLocation()
  const goBack = () => (location.key !== 'default' ? navigate(-1) : navigate('/events'))
  const { meId, people, areaPeople } = usePeople()
  const todayISO = toLocalISODate()

  const [form, setForm] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [saveError, setSaveError] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (isNew) {
      // Default to a shared area, so both of you see it
      const shared = areas.find((a) => isShared(areaPeople, a.id))
      const start = searchParams.get('date') || todayISO
      setForm({
        kind: searchParams.get('kind') === 'trip' ? 'trip' : 'event',
        title: '',
        areaId: (shared ?? areas[0])?.id ?? '',
        personId: null,
        startDate: start,
        endDate: start,
        allDay: true,
        startTime: '',
        endTime: '',
        multiDay: false,
        timeZone: null,
        notes: '',
      })
      return
    }
    let cancelled = false
    fetchEvent(id)
      .then((ev) => {
        if (cancelled) return
        if (!ev) return setLoadError('This trip or event no longer exists.')
        setForm({
          ...ev,
          kind: ev.personId ? 'trip' : 'event',
          allDay: !ev.startTime,
          startTime: ev.startTime ?? '',
          endTime: ev.endTime ?? '',
          multiDay: ev.endDate !== ev.startDate,
          notes: ev.notes ?? '',
        })
      })
      .catch((e) => !cancelled && setLoadError(e.message))
    return () => {
      cancelled = true
    }
    // Only when the id in the address changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const update = (field, value) => setForm((prev) => ({ ...prev, [field]: value }))

  if (loadError) {
    return (
      <div className="screen status-screen" role="alert">
        <h1>Not found</h1>
        <p>{loadError}</p>
        <button type="button" className="btn-primary" onClick={() => navigate('/events')}>
          Back to trips &amp; events
        </button>
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

  // Who can be away: anyone in the chosen area (just you, if it isn't shared)
  const inArea = areaPeople[form.areaId] ?? [meId]
  const choices = [meId, ...inArea.filter((p) => p !== meId)]
  const isTripForm = form.kind === 'trip'
  // A trip always has someone away: whoever was picked, else the other
  // person in a shared area, else you
  const picked = form.personId && inArea.includes(form.personId) ? form.personId : null
  const personId = isTripForm ? (picked ?? inArea.find((p) => p !== meId) ?? meId) : null
  const showEndDate = isTripForm || form.multiDay
  const timed = !isTripForm && !form.allDay

  async function handleSave(e) {
    e.preventDefault()
    if (!form.title.trim()) return setSaveError('Give it a title, like "Chicago" or "PD1 exam".')
    if (!form.areaId) return setSaveError('Pick an area.')
    if (!form.startDate || !form.endDate) return setSaveError('Pick the dates.')
    const endDate = showEndDate ? form.endDate : form.startDate
    if (endDate < form.startDate) return setSaveError("The end date can't be before the start date.")
    if (timed && !form.startTime) return setSaveError('Pick a start time, or switch on All day.')
    if (timed && form.endTime && endDate === form.startDate && form.endTime <= form.startTime)
      return setSaveError('The end time has to be after the start time.')
    setBusy(true)
    setSaveError(null)
    try {
      await saveEvent({
        id: id ?? null,
        areaId: form.areaId,
        personId,
        title: form.title,
        startDate: form.startDate,
        endDate,
        startTime: timed ? form.startTime : null,
        endTime: timed ? form.endTime : null,
        timeZone: form.timeZone,
        notes: form.notes,
      })
      onSaved()
      announce(isNew ? `Added: ${form.title.trim()}` : 'Saved')
      goBack()
    } catch (err) {
      setSaveError(err.message)
      setBusy(false)
    }
  }

  async function handleDelete() {
    if (!window.confirm(`Delete "${form.title}"? Everyone in the area will stop seeing it.`)) return
    setBusy(true)
    try {
      await deleteEvent(id)
      onSaved()
      announce('Deleted')
      goBack()
    } catch (err) {
      setSaveError(err.message)
      setBusy(false)
    }
  }

  return (
    <form className="screen task-form" onSubmit={handleSave} noValidate>
      <header className="form-header">
        <button type="button" className="text-btn" onClick={goBack}>
          Cancel
        </button>
        <h1 className="form-heading">
          {isNew ? (isTripForm ? 'New trip' : 'New event') : isTripForm ? 'Edit trip' : 'Edit event'}
        </h1>
        <button type="submit" className="btn-dark" disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </header>

      <div className="form-body">
        <label className="field">
          <span className="field-caps">TITLE</span>
          <input
            className="title-input"
            value={form.title}
            onChange={(e) => update('title', e.target.value)}
            placeholder={isTripForm ? 'Chicago · client site' : 'PD1 exam'}
            maxLength={120}
            autoFocus={isNew}
          />
        </label>

        <div className="chip-row kind-row" role="group" aria-label="Trip or event">
          {[
            ['event', 'Event'],
            ['trip', 'Trip · someone away'],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={`chip chip-lg${form.kind === value ? ' is-on' : ''}`}
              aria-pressed={form.kind === value}
              onClick={() => update('kind', value)}
            >
              {label}
            </button>
          ))}
        </div>

        {isTripForm && (
          <fieldset className="field">
            <legend className="field-caps">WHO'S AWAY</legend>
            <div className="chip-row">
              {choices.map((p) => (
                <button
                  key={p}
                  type="button"
                  className={`chip chip-lg${personId === p ? ' is-on' : ''}`}
                  aria-pressed={personId === p}
                  onClick={() => update('personId', p)}
                >
                  {nameFor(p, meId, people)}
                </button>
              ))}
            </div>
          </fieldset>
        )}

        <div className="date-pair">
          <label className="field">
            <span className="field-caps">{isTripForm ? 'LEAVES' : showEndDate ? 'FROM' : 'DATE'}</span>
            <input
              type="date"
              className="box-input"
              value={form.startDate}
              onChange={(e) => {
                const v = e.target.value
                setForm((prev) => ({ ...prev, startDate: v, endDate: prev.endDate < v ? v : prev.endDate }))
              }}
            />
          </label>
          {showEndDate && (
            <label className="field">
              <span className="field-caps">{isTripForm ? 'BACK' : 'TO'}</span>
              <input
                type="date"
                className="box-input"
                min={form.startDate}
                value={form.endDate}
                onChange={(e) => update('endDate', e.target.value)}
              />
            </label>
          )}
        </div>

        {!isTripForm && (
          <>
            <button
              type="button"
              className="text-btn small-link"
              onClick={() =>
                setForm((prev) => ({
                  ...prev,
                  multiDay: !prev.multiDay,
                  endDate: prev.multiDay ? prev.startDate : prev.endDate,
                }))
              }
            >
              {form.multiDay ? 'Just one day' : 'Ends another day'}
            </button>

            <div className="settings-card">
              <div className="settings-row">
                <div className="settings-text">
                  <span className="settings-name" id="all-day-label">All day</span>
                  <span className="settings-sub">Switch off to set a time.</span>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={form.allDay}
                  aria-labelledby="all-day-label"
                  className={`switch${form.allDay ? ' is-on' : ''}`}
                  onClick={() => update('allDay', !form.allDay)}
                >
                  <span />
                </button>
              </div>
            </div>

            {timed && (
              <div className="date-pair">
                <label className="field">
                  <span className="field-caps">STARTS</span>
                  <input
                    type="time"
                    className="box-input"
                    step="300"
                    value={form.startTime}
                    onChange={(e) => update('startTime', e.target.value)}
                  />
                </label>
                <label className="field">
                  <span className="field-caps">ENDS · OPTIONAL</span>
                  <input
                    type="time"
                    className="box-input"
                    step="300"
                    value={form.endTime}
                    onChange={(e) => update('endTime', e.target.value)}
                  />
                </label>
              </div>
            )}
          </>
        )}

        <fieldset className="field">
          <legend className="field-caps">WHO CAN SEE IT</legend>
          <div className="chip-row">
            {areas.map((area) => {
              const on = form.areaId === area.id
              const shared = isShared(areaPeople, area.id)
              return (
                <button
                  type="button"
                  key={area.id}
                  className={`chip chip-lg${on ? ' is-on' : ''}`}
                  aria-pressed={on}
                  onClick={() => update('areaId', area.id)}
                >
                  <span className="dot" style={{ background: on ? '#FFFFFF' : area.color }} />
                  {area.name}
                  {shared ? ' · shared' : ''}
                </button>
              )
            })}
          </div>
          <span className="hint">
            {isShared(areaPeople, form.areaId)
              ? 'Everyone in this area sees it on Today and Week.'
              : 'Only you will see it (this area isn’t shared).'}
          </span>
        </fieldset>

        <NotesEditor
          id="event-notes"
          value={form.notes}
          onChange={(v) => update('notes', v)}
          placeholder={isTripForm ? 'Hotel, flight times…' : 'Room, what to bring…'}
        />

        {saveError && (
          <p className="form-error" role="alert">
            {saveError}
          </p>
        )}

        {!isNew && (
          <button type="button" className="danger-btn" onClick={handleDelete} disabled={busy}>
            {isTripForm ? 'Delete this trip' : 'Delete this event'}
          </button>
        )}
      </div>
    </form>
  )
}
