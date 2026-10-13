import { useEffect, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router'
import NotesEditor from '../components/NotesEditor.jsx'
import RepeatPicker, { daysToSave, repeatProblem } from '../components/RepeatPicker.jsx'
import { deleteRepeatRule, fetchRepeatRule, makeMyRepeats, saveRepeatRule } from '../lib/api.js'
import { formatShortDate, toLocalISODate } from '../lib/dates.js'
import { nameFor, usePeople } from '../lib/people.js'
import { nextOccurrence } from '../lib/repeat.js'

/**
 * Edit a repeating task (/repeats/:id): what it says, where, who, and when.
 * Changes apply to copies from now on; copies already on a docket stay as
 * they are. A routine's repeat is edited on the routine instead.
 */
export default function RepeatForm({ areas, onSaved, announce }) {
  const { id } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const goBack = () => (location.key !== 'default' ? navigate(-1) : navigate('/routines'))
  const { meId, people, areaPeople } = usePeople()
  const todayISO = toLocalISODate()

  const [form, setForm] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [saveError, setSaveError] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetchRepeatRule(id)
      .then((rule) => {
        if (cancelled) return
        if (!rule) return setLoadError('This repeat was stopped or no longer exists.')
        if (rule.routineId) return navigate(`/routines/${rule.routineId}`, { replace: true })
        setForm({ ...rule, repeatUntil: rule.repeatUntil ?? '' })
      })
      .catch((e) => !cancelled && setLoadError(e.message))
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  if (loadError) {
    return (
      <div className="screen status-screen" role="alert">
        <h1>Not found</h1>
        <p>{loadError}</p>
        <button type="button" className="btn-primary" onClick={() => navigate('/routines')}>
          Back to routines
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

  const update = (change) => setForm((prev) => ({ ...prev, ...change }))
  const inArea = areaPeople[form.areaId] ?? [meId]
  const canAssign = inArea.length > 1
  const assignee = canAssign && inArea.includes(form.assignedTo) ? form.assignedTo : null
  const next = nextOccurrence({ ...form, repeatDays: daysToSave(form, form.startDate) }, todayISO)

  async function handleSave(e) {
    e.preventDefault()
    if (!form.title.trim()) return setSaveError('Give it a title.')
    const issue = repeatProblem(form, form.startDate)
    if (issue) return setSaveError(issue)
    if (!form.repeat) return handleStop()
    setBusy(true)
    setSaveError(null)
    try {
      await saveRepeatRule({
        id,
        areaId: form.areaId,
        assignedTo: assignee,
        title: form.title,
        notes: form.notes,
        repeat: form.repeat,
        repeatDays: daysToSave(form, form.startDate),
        startDate: form.startDate,
        repeatUntil: form.repeatUntil,
        ifMissed: form.ifMissed,
      })
      await makeMyRepeats(todayISO).catch(() => {})
      onSaved?.()
      announce('Saved. Changes apply from the next one.')
      goBack()
    } catch (err) {
      setSaveError(err.message)
      setBusy(false)
    }
  }

  async function handleStop() {
    if (!window.confirm(`Stop repeating "${form.title}"? Copies already on your docket stay.`)) return
    setBusy(true)
    try {
      await deleteRepeatRule(id)
      onSaved?.()
      announce('Stopped repeating')
      navigate('/routines')
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
        <h1 className="form-heading">Edit repeat</h1>
        <button type="submit" className="btn-dark" disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </header>

      <div className="form-body">
        <p className="series-note">
          Changes apply from the next copy. {next ? `Next: ${formatShortDate(next, todayISO)}.` : 'No dates left.'}
        </p>

        <label className="field">
          <span className="field-caps">TASK</span>
          <input
            className="title-input"
            value={form.title}
            onChange={(e) => update({ title: e.target.value })}
            maxLength={200}
          />
        </label>

        <fieldset className="field">
          <legend className="field-caps">AREA</legend>
          <div className="chip-row">
            {areas.map((area) => {
              const on = form.areaId === area.id
              return (
                <button
                  type="button"
                  key={area.id}
                  className={`chip chip-lg${on ? ' is-on' : ''}`}
                  aria-pressed={on}
                  onClick={() => update({ areaId: area.id })}
                >
                  <span className="dot" style={{ background: on ? '#FFFFFF' : area.color }} />
                  {area.name}
                </button>
              )
            })}
          </div>
        </fieldset>

        {canAssign && (
          <fieldset className="field">
            <legend className="field-caps">ASSIGNED TO</legend>
            <div className="chip-row">
              {[null, meId, ...inArea.filter((p) => p !== meId)].map((p) => (
                <button
                  key={p ?? 'anyone'}
                  type="button"
                  className={`chip chip-lg${assignee === p ? ' is-on' : ''}`}
                  aria-pressed={assignee === p}
                  onClick={() => update({ assignedTo: p })}
                >
                  {p ? nameFor(p, meId, people) : 'Anyone'}
                </button>
              ))}
            </div>
          </fieldset>
        )}

        <label className="field">
          <span className="field-caps">STARTS</span>
          <input
            type="date"
            className="box-input"
            value={form.startDate}
            onChange={(e) => e.target.value && update({ startDate: e.target.value })}
          />
        </label>

        <RepeatPicker value={form} startDate={form.startDate} onChange={(v) => update(v)} />

        <NotesEditor id="repeat-notes" value={form.notes ?? ''} onChange={(v) => update({ notes: v })} />

        {saveError && (
          <p className="form-error" role="alert">
            {saveError}
          </p>
        )}

        <button type="button" className="danger-btn" onClick={handleStop} disabled={busy}>
          Stop repeating
        </button>
      </div>
    </form>
  )
}
