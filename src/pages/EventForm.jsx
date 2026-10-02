import { useEffect, useState } from 'react'
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router'
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
        title: '',
        areaId: (shared ?? areas[0])?.id ?? '',
        personId: null,
        startDate: start,
        endDate: start,
        notes: '',
      })
      return
    }
    let cancelled = false
    fetchEvent(id)
      .then((ev) => {
        if (cancelled) return
        if (!ev) return setLoadError('This trip or event no longer exists.')
        setForm({ ...ev, notes: ev.notes ?? '' })
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
  const personId = form.personId && inArea.includes(form.personId) ? form.personId : null

  async function handleSave(e) {
    e.preventDefault()
    if (!form.title.trim()) return setSaveError('Give it a title, like "Chicago" or "PD1 exam".')
    if (!form.areaId) return setSaveError('Pick an area.')
    if (!form.startDate || !form.endDate) return setSaveError('Pick the dates.')
    if (form.endDate < form.startDate) return setSaveError("The end date can't be before the start date.")
    setBusy(true)
    setSaveError(null)
    try {
      await saveEvent({ ...form, id: id ?? null, personId })
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
        <h1 className="form-heading">{isNew ? 'New trip or event' : 'Edit trip or event'}</h1>
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
            placeholder="Chicago · client site"
            maxLength={120}
            autoFocus={isNew}
          />
        </label>

        <fieldset className="field">
          <legend className="field-caps">WHO'S AWAY</legend>
          <div className="chip-row">
            <button
              type="button"
              className={`chip chip-lg${personId === null ? ' is-on' : ''}`}
              aria-pressed={personId === null}
              onClick={() => update('personId', null)}
            >
              No one · it's an event
            </button>
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

        <div className="date-pair">
          <label className="field">
            <span className="field-caps">{personId ? 'LEAVES' : 'FROM'}</span>
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
          <label className="field">
            <span className="field-caps">{personId ? 'BACK' : 'TO'}</span>
            <input
              type="date"
              className="box-input"
              min={form.startDate}
              value={form.endDate}
              onChange={(e) => update('endDate', e.target.value)}
            />
          </label>
        </div>

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

        <label className="field">
          <span className="field-caps">NOTES</span>
          <textarea
            className="notes-input"
            value={form.notes}
            onChange={(e) => update('notes', e.target.value)}
            rows={3}
            placeholder="Hotel, flight times…"
          />
        </label>

        {saveError && (
          <p className="form-error" role="alert">
            {saveError}
          </p>
        )}

        {!isNew && (
          <button type="button" className="danger-btn" onClick={handleDelete} disabled={busy}>
            Delete this trip or event
          </button>
        )}
      </div>
    </form>
  )
}
