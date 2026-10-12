import { useEffect, useState } from 'react'
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router'
import NotesEditor from '../components/NotesEditor.jsx'
import {
  deleteEvent,
  detachOccurrence,
  endSeries,
  fetchEvent,
  fetchSettings,
  saveEvent,
  skipOccurrence,
  splitSeries,
} from '../lib/api.js'
import { formatDayMonth, toLocalISODate } from '../lib/dates.js'
import { REPEAT_CHOICES, WEEKDAYS, defaultDays, patternOn, repeatSummary } from '../lib/repeat.js'
import { isShared, nameFor, usePeople } from '../lib/people.js'
import { DEFAULT_REMIND, REMIND_CHOICES, remindLabel } from '../lib/schedule.js'

/**
 * Add (/events/new) or edit (/events/:id) a trip or event.
 * A repeating event opened on one of its dates (/events/:id?date=...)
 * asks whether a change is for just that date or that date and later.
 */
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
  // Your reminder settings: the default for a new meeting, and whether they're on
  const [reminders, setReminders] = useState({ on: true, byDefault: DEFAULT_REMIND })
  // A repeating event opened on one of its dates: that date, else null
  const [occurrence, setOccurrence] = useState(null)
  const [askScope, setAskScope] = useState(false) // "Just this one / This and later ones?"
  const [askDelete, setAskDelete] = useState(false)

  useEffect(() => {
    fetchSettings()
      .then((s) => s && setReminders({ on: s.meetingReminders, byDefault: s.remindDefault }))
      .catch(() => {}) // before SQL 021, or offline: the 10-minute default stands
  }, [])

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
        remindMinutes: undefined, // undefined = your default from Settings
        repeat: null,
        repeatDays: null,
        repeatUntil: '',
        notes: '',
      })
      return
    }
    let cancelled = false
    fetchEvent(id)
      .then((ev) => {
        if (cancelled) return
        if (!ev) return setLoadError('This trip or event no longer exists.')
        // Opened on one date of a series: show that date
        const date = searchParams.get('date')
        const onDate = ev.repeat && date && patternOn(ev, date) ? date : null
        setOccurrence(onDate)
        setForm({
          ...ev,
          seriesStart: ev.startDate,
          startDate: onDate ?? ev.startDate,
          endDate: onDate ?? ev.endDate,
          repeatUntil: ev.repeatUntil ?? '',
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

  // The question appears at the bottom of the form; bring it into view
  useEffect(() => {
    if (askScope || askDelete) document.querySelector('.scope-ask')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [askScope, askDelete])

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
  const remindMinutes = form.remindMinutes === undefined ? reminders.byDefault : form.remindMinutes
  // Only a one-day event can repeat
  const canRepeat = !isTripForm && !form.multiDay
  const repeat = canRepeat ? form.repeat : null
  const needsDays = repeat === 'weekly' || repeat === 'biweekly'
  const repeatDays = needsDays ? (form.repeatDays?.length ? form.repeatDays : defaultDays(form.startDate)) : null
  const pattern = { ...form, repeat, repeatDays, repeatUntil: form.repeatUntil || null }

  function toggleDay(day) {
    const now = repeatDays ?? []
    const next = now.includes(day) ? now.filter((d) => d !== day) : [...now, day].sort()
    update('repeatDays', next)
  }

  // Everything the form says, ready for saveEvent
  function fields(endDate) {
    return {
      areaId: form.areaId,
      personId,
      title: form.title,
      startDate: form.startDate,
      endDate,
      startTime: timed ? form.startTime : null,
      endTime: timed ? form.endTime : null,
      timeZone: form.timeZone,
      remindMinutes: timed ? remindMinutes : null,
      repeat,
      repeatDays,
      repeatUntil: repeat ? form.repeatUntil || null : null,
      notes: form.notes,
    }
  }

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
    if (needsDays && !repeatDays.length) return setSaveError('Pick at least one day for it to repeat on.')
    if (repeat && form.repeatUntil && form.repeatUntil < form.startDate)
      return setSaveError('The until date has to be after the start.')
    // One date of a series: ask which dates the change is for
    if (occurrence) return setAskScope(true)
    await save(() => saveEvent({ id: id ?? null, ...fields(endDate) }), isNew ? `Added: ${form.title.trim()}` : 'Saved')
  }

  async function save(run, message) {
    setBusy(true)
    setSaveError(null)
    try {
      await run()
      onSaved()
      announce(message)
      goBack()
    } catch (err) {
      setSaveError(err.message)
      setBusy(false)
    }
  }

  // "Just this one": that date becomes its own event with the changes
  const saveJustThisOne = () =>
    save(
      async () => {
        const newId = await detachOccurrence(id, occurrence)
        await saveEvent({ id: newId, ...fields(form.startDate), repeat: null })
      },
      `Saved for ${formatDayMonth(occurrence)} only`,
    )

  // "This and later ones": a new series from that date with the changes
  const saveThisAndLater = () =>
    save(
      async () => {
        const newId = await splitSeries(id, occurrence)
        await saveEvent({ id: newId, ...fields(form.startDate) })
      },
      `Saved from ${formatDayMonth(occurrence)} on`,
    )

  async function handleDelete() {
    // A series asks what to remove
    if (form.repeat) return setAskDelete(true)
    if (!window.confirm(`Delete "${form.title}"? Everyone in the area will stop seeing it.`)) return
    await save(() => deleteEvent(id), 'Deleted')
  }

  const deleteSeries = () => {
    if (!window.confirm(`Delete every "${form.title}", past and future? Everyone in the area will stop seeing it.`))
      return
    save(() => deleteEvent(id), 'Series deleted')
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

        {occurrence && (
          <p className="series-note">
            ↻ {repeatSummary({ ...form, startDate: form.seriesStart })}. You're changing{' '}
            <strong>{formatDayMonth(occurrence)}</strong>; you'll be asked if it's for just this one or later ones too.
          </p>
        )}

        {!occurrence && (
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
        )}

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
            <span className="field-caps">
              {isTripForm ? 'LEAVES' : showEndDate ? 'FROM' : repeat && !occurrence ? 'STARTS' : 'DATE'}
            </span>
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
            {!repeat && (
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
            )}

            {canRepeat && (
              <fieldset className="field repeat-row">
                <legend className="field-caps">REPEATS</legend>
                <div className="chip-row">
                  {REPEAT_CHOICES.map(([value, label]) => (
                    <button
                      key={value ?? 'never'}
                      type="button"
                      className={`chip chip-lg${repeat === value ? ' is-on' : ''}`}
                      aria-pressed={repeat === value}
                      onClick={() => update('repeat', value)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {needsDays && (
                  <div className="chip-row weekday-row" role="group" aria-label="Which days">
                    {WEEKDAYS.map(([day, short, long]) => (
                      <button
                        key={day}
                        type="button"
                        className={`chip weekday-chip${repeatDays.includes(day) ? ' is-on' : ''}`}
                        aria-pressed={repeatDays.includes(day)}
                        aria-label={long}
                        onClick={() => toggleDay(day)}
                      >
                        {short.slice(0, 2)}
                      </button>
                    ))}
                  </div>
                )}
                {repeat && (
                  <>
                    <label className="field inline-field">
                      <span className="field-caps">UNTIL · OPTIONAL</span>
                      <div className="due-row">
                        <input
                          type="date"
                          className="box-input"
                          min={form.startDate}
                          value={form.repeatUntil}
                          onChange={(e) => update('repeatUntil', e.target.value)}
                        />
                        {form.repeatUntil && (
                          <button type="button" className="text-btn" onClick={() => update('repeatUntil', '')}>
                            Clear
                          </button>
                        )}
                      </div>
                    </label>
                    {(!needsDays || repeatDays.length > 0) && <span className="hint">↻ {repeatSummary(pattern)}</span>}
                  </>
                )}
              </fieldset>
            )}

            <div className="settings-card">
              <div className="settings-row">
                <div className="settings-text">
                  <span className="settings-name" id="all-day-label">
                    All day
                  </span>
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
              <>
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

                <fieldset className="field remind-row">
                  <legend className="field-caps">REMIND ME</legend>
                  <div className="chip-row">
                    {REMIND_CHOICES.map((m) => (
                      <button
                        key={m ?? 'none'}
                        type="button"
                        className={`chip chip-lg${remindMinutes === m ? ' is-on' : ''}`}
                        aria-pressed={remindMinutes === m}
                        onClick={() => update('remindMinutes', m)}
                      >
                        {remindLabel(m)}
                      </button>
                    ))}
                  </div>
                  <span className="hint">
                    {!reminders.on
                      ? 'Meeting reminders are off in Settings, so none will be sent.'
                      : remindMinutes === null
                        ? 'No reminder for this one.'
                        : isShared(areaPeople, form.areaId)
                          ? 'A notification before it starts, to everyone in this area who has meeting reminders on.'
                          : `A notification before it starts. ${remindLabel(reminders.byDefault)} is your default (Settings).`}
                  </span>
                </fieldset>
              </>
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

        {askScope && (
          <div className="scope-ask" role="dialog" aria-label="Which dates?">
            <p>
              Save the changes for <strong>{formatDayMonth(occurrence)}</strong> only, or for it and every later one?
            </p>
            <div className="routine-actions">
              <button type="button" className="btn-secondary" disabled={busy} onClick={saveJustThisOne}>
                Just this one
              </button>
              <button type="button" className="btn-secondary" disabled={busy} onClick={saveThisAndLater}>
                This and later ones
              </button>
              <button type="button" className="text-btn" onClick={() => setAskScope(false)}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {askDelete && (
          <div className="scope-ask" role="dialog" aria-label="Delete which dates?">
            <p>{form.title} repeats. What should go?</p>
            <div className="scope-buttons">
              {occurrence && (
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={busy}
                  onClick={() => save(() => skipOccurrence(id, occurrence), `Skipped ${formatDayMonth(occurrence)}`)}
                >
                  Not this time ({formatDayMonth(occurrence)})
                </button>
              )}
              {occurrence && occurrence > form.seriesStart && (
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={busy}
                  onClick={() => save(() => endSeries(id, occurrence), `Ended before ${formatDayMonth(occurrence)}`)}
                >
                  This and later ones
                </button>
              )}
              <button type="button" className="danger-btn" disabled={busy} onClick={deleteSeries}>
                Every one, past and future
              </button>
              <button type="button" className="text-btn" onClick={() => setAskDelete(false)}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {!isNew && !askDelete && (
          <button type="button" className="danger-btn" onClick={handleDelete} disabled={busy}>
            {isTripForm ? 'Delete this trip' : form.repeat ? 'Delete…' : 'Delete this event'}
          </button>
        )}
      </div>
    </form>
  )
}
