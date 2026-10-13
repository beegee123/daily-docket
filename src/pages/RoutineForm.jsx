import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router'
import RepeatPicker, { daysToSave, repeatProblem } from '../components/RepeatPicker.jsx'
import {
  deleteRepeatRule,
  deleteRoutine,
  fetchRoutine,
  fetchRoutineRule,
  makeMyRepeats,
  saveRepeatRule,
  saveRoutine,
} from '../lib/api.js'
import { toLocalISODate } from '../lib/dates.js'
import { cleanSteps, insertStepAfter, MAX_STEPS, moveStep, pastedSteps, removeStep } from '../lib/routines.js'

/**
 * Add (/routines/new) or edit (/routines/:id) a routine: name, area, steps
 * in order, and optionally a schedule it repeats on (steps 17-18).
 */
export default function RoutineForm({ areas, onSaved, announce }) {
  const { id } = useParams()
  const isNew = !id
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const location = useLocation()
  const goBack = () => (location.key !== 'default' ? navigate(-1) : navigate('/routines'))

  const [form, setForm] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [saveError, setSaveError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [pasting, setPasting] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const stepRefs = useRef([])
  const focusNext = useRef(null) // index of a step to focus after it appears
  const todayISO = toLocalISODate()
  // Its repeat: the saved rule (or null), and what the form shows
  const [rule, setRule] = useState(null)
  const [repeat, setRepeat] = useState({ repeat: null, repeatDays: null, repeatUntil: '', ifMissed: 'fresh' })

  useEffect(() => {
    if (isNew) {
      const area = searchParams.get('area')
      setForm({ name: '', areaId: area && areas.some((a) => a.id === area) ? area : null, steps: [''] })
      return
    }
    let cancelled = false
    fetchRoutine(id)
      .then((r) => {
        if (cancelled) return
        if (!r) return setLoadError('This routine no longer exists.')
        setForm({ name: r.name, areaId: r.areaId, steps: r.steps.length ? r.steps : [''] })
      })
      .catch((e) => !cancelled && setLoadError(e.message))
    // Its repeat, if it has one (before SQL 023 there are none)
    fetchRoutineRule(id)
      .then((found) => {
        if (cancelled || !found) return
        setRule(found)
        setRepeat({ ...found, repeatUntil: found.repeatUntil ?? '' })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  // Put the cursor in a step that was just added
  useEffect(() => {
    if (focusNext.current === null) return
    stepRefs.current[focusNext.current]?.focus()
    focusNext.current = null
  })

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

  const setSteps = (steps) => setForm((prev) => ({ ...prev, steps }))
  const setStep = (i, value) => setSteps(form.steps.map((s, j) => (j === i ? value : s)))

  function addStepAfter(i) {
    if (form.steps.length >= MAX_STEPS) return setSaveError(`A routine can have up to ${MAX_STEPS} steps.`)
    setSteps(insertStepAfter(form.steps, i))
    focusNext.current = i + 1
  }

  function onStepKey(e, i) {
    // Enter: a new step below. Backspace in an empty step: remove it.
    if (e.key === 'Enter') {
      e.preventDefault()
      addStepAfter(i)
    } else if (e.key === 'Backspace' && form.steps[i] === '' && form.steps.length > 1) {
      e.preventDefault()
      setSteps(removeStep(form.steps, i))
      focusNext.current = Math.max(0, i - 1)
    }
  }

  function applyPasted() {
    const added = pastedSteps(pasteText)
    if (!added.length) return setSaveError('Paste or type at least one line.')
    const merged = [...cleanSteps(form.steps), ...added].slice(0, MAX_STEPS)
    setSteps(merged)
    setPasting(false)
    setPasteText('')
    setSaveError(null)
  }

  async function handleSave(e) {
    e.preventDefault()
    const steps = cleanSteps(form.steps)
    if (!form.name.trim()) return setSaveError('Give the routine a name, like "Guest turnover".')
    if (!form.areaId) return setSaveError('Pick an area.')
    if (steps.length === 0) return setSaveError('Add at least one step.')
    if (steps.length > MAX_STEPS) return setSaveError(`A routine can have up to ${MAX_STEPS} steps.`)
    const startDate = rule?.startDate ?? todayISO
    const issue = repeatProblem(repeat, startDate)
    if (issue) return setSaveError(issue)
    setBusy(true)
    setSaveError(null)
    try {
      const routineId = await saveRoutine({ id: id ?? null, areaId: form.areaId, name: form.name, steps })
      if (repeat.repeat) {
        await saveRepeatRule({
          id: rule?.id ?? null,
          routineId,
          areaId: form.areaId,
          repeat: repeat.repeat,
          repeatDays: daysToSave(repeat, startDate),
          startDate,
          repeatUntil: repeat.repeatUntil,
          ifMissed: repeat.ifMissed,
        })
        // If it's due today, today's copy appears now
        await makeMyRepeats(todayISO).catch(() => {})
      } else if (rule) {
        await deleteRepeatRule(rule.id) // copies already made stay
      }
      onSaved?.()
      announce(isNew ? `Saved: ${form.name.trim()}` : 'Saved')
      goBack()
    } catch (err) {
      setSaveError(err.message)
      setBusy(false)
    }
  }

  async function handleDelete() {
    if (!window.confirm(`Delete the routine "${form.name}"? Tasks already started from it stay.`)) return
    setBusy(true)
    try {
      await deleteRoutine(id)
      announce('Routine deleted')
      navigate('/routines')
    } catch (err) {
      setSaveError(err.message)
      setBusy(false)
    }
  }

  const count = cleanSteps(form.steps).length

  return (
    <form className="screen task-form" onSubmit={handleSave} noValidate>
      <header className="form-header">
        <button type="button" className="text-btn" onClick={goBack}>
          Cancel
        </button>
        <h1 className="form-heading">{isNew ? 'New routine' : 'Edit routine'}</h1>
        <button type="submit" className="btn-dark" disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </header>

      <div className="form-body">
        <label className="field">
          <span className="field-caps">ROUTINE</span>
          <input
            className="title-input"
            value={form.name}
            onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
            placeholder="Guest turnover"
            maxLength={80}
            autoFocus={isNew}
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
                  onClick={() => setForm((prev) => ({ ...prev, areaId: area.id }))}
                >
                  <span className="dot" style={{ background: on ? '#FFFFFF' : area.color }} />
                  {area.name}
                </button>
              )
            })}
          </div>
          <span className="hint">Everyone who shares this area can see, use and edit the routine.</span>
        </fieldset>

        <fieldset className="field">
          <legend className="field-caps">
            STEPS · {count} {count === 1 ? 'STEP' : 'STEPS'}
          </legend>

          {pasting ? (
            <div className="paste-steps">
              <label className="visually-hidden" htmlFor="paste-steps">
                Paste steps, one per line
              </label>
              <textarea
                id="paste-steps"
                className="box-input paste-input"
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                placeholder={'Strip beds and start laundry\nClean kitchen and bathroom\nRestock toiletries and coffee'}
                autoFocus
              />
              <span className="hint">One step per line. Bullets, numbers and checkboxes are removed.</span>
              <div className="routine-actions">
                <button type="button" className="btn-secondary" onClick={applyPasted}>
                  Add {pastedSteps(pasteText).length || ''} {pastedSteps(pasteText).length === 1 ? 'step' : 'steps'}
                </button>
                <button type="button" className="text-btn" onClick={() => setPasting(false)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              <ol className="step-editor">
                {form.steps.map((step, i) => (
                  <li key={i} className="step-edit-row">
                    <span className="step-num" aria-hidden="true">
                      {i + 1}
                    </span>
                    <input
                      ref={(el) => (stepRefs.current[i] = el)}
                      className="box-input step-input"
                      value={step}
                      onChange={(e) => setStep(i, e.target.value)}
                      onKeyDown={(e) => onStepKey(e, i)}
                      placeholder={i === 0 ? 'First step' : 'Next step'}
                      maxLength={200}
                      aria-label={`Step ${i + 1}`}
                      enterKeyHint="next"
                    />
                    <button
                      type="button"
                      className="icon-btn small"
                      aria-label={`Move step ${i + 1} up`}
                      disabled={i === 0}
                      onClick={() => setSteps(moveStep(form.steps, i, -1))}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="icon-btn small"
                      aria-label={`Move step ${i + 1} down`}
                      disabled={i === form.steps.length - 1}
                      onClick={() => setSteps(moveStep(form.steps, i, 1))}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className="icon-btn small danger-text"
                      aria-label={`Remove step ${i + 1}`}
                      onClick={() => setSteps(form.steps.length > 1 ? removeStep(form.steps, i) : [''])}
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ol>
              <div className="routine-actions">
                <button type="button" className="btn-secondary" onClick={() => addStepAfter(form.steps.length - 1)}>
                  Add a step
                </button>
                <button type="button" className="text-btn" onClick={() => setPasting(true)}>
                  Paste a list
                </button>
              </div>
              <span className="hint">Enter adds the next step.</span>
            </>
          )}
        </fieldset>

        <RepeatPicker value={repeat} startDate={rule?.startDate ?? todayISO} onChange={setRepeat} />
        {repeat.repeat && (
          <p className="hint repeat-note">
            Each time, one task called “{form.name.trim() || 'this routine'}” with these steps lands on Today by itself.
          </p>
        )}

        {saveError && (
          <p className="form-error" role="alert">
            {saveError}
          </p>
        )}

        {!isNew && (
          <button type="button" className="danger-btn" onClick={handleDelete} disabled={busy}>
            Delete this routine
          </button>
        )}
      </div>
    </form>
  )
}
