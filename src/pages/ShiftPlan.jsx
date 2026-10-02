import { useEffect, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router'
import { fetchOpenInArea, reschedule } from '../lib/api.js'
import { formatDayMonth, toLocalISODate } from '../lib/dates.js'
import { planShift } from '../lib/shift.js'
import { isMyJob } from '../lib/tasks.js'

const STEPS = [-7, -3, -1, 1, 3, 7]
const signed = (n) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n)}`
const dayWord = (n) => (Math.abs(n) === 1 ? 'day' : 'days')

/**
 * Slide every open task in one area forward or back by N days.
 * Nothing is saved until "Shift"; then Undo is offered for a few seconds.
 */
export default function ShiftPlan({ areas, userId, onChanged, announce }) {
  const { areaId } = useParams()
  const navigate = useNavigate()
  const area = areas.find((a) => a.id === areaId)
  const todayISO = toLocalISODate()

  const [days, setDays] = useState(1)
  const [tasks, setTasks] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!area) return
    let cancelled = false
    fetchOpenInArea(area.id)
      // Only your jobs; in a shared area, other people's tasks stay put
      .then((rows) => !cancelled && setTasks(rows.filter((t) => isMyJob(t, userId))))
      .catch((e) => !cancelled && setError(e.message))
    return () => {
      cancelled = true
    }
  }, [area, userId])

  if (!area) return <Navigate to="/week" replace />

  const areasById = Object.fromEntries(areas.map((a) => [a.id, a]))
  const plan = tasks ? planShift(tasks, days, todayISO) : null
  const shared = plan ? plan.moves.filter((m) => m.task.areaIds.length > 1) : []

  async function handleShift() {
    setBusy(true)
    setError(null)
    try {
      const moved = await reschedule(plan.items)
      const undoItems = plan.undoItems
      onChanged()
      announce(`${area.name} plan shifted ${signed(days)} ${dayWord(days)} · ${moved} moved`, {
        label: 'Undo',
        run: async () => {
          try {
            await reschedule(undoItems)
            onChanged()
            announce('Shift undone')
          } catch (e) {
            announce(`Couldn't undo: ${e.message}`)
          }
        },
      })
      navigate(-1)
    } catch (e) {
      setError(e.message)
      setBusy(false)
    }
  }

  return (
    <div className="screen shift">
      <header className="close-header">
        <button type="button" className="text-btn back-link" onClick={() => navigate(-1)}>
          Back to week
        </button>
        <span className="eyebrow">SHIFT PLAN</span>
        <h1 className="shift-title">
          <span className="shift-swatch" style={{ background: area.color }} aria-hidden="true" />
          {area.name}
        </h1>
        <p className="lead">
          Move every open {area.name} task that's yours earlier or later. Done tasks stay where they are.
        </p>
      </header>

      <main className="lists">
        <section className="shift-card" aria-label="How far to shift">
          <div className="shift-amount" aria-live="polite">
            <span className="shift-number">{signed(days)}</span>
            <span className="shift-unit">{dayWord(days)}</span>
          </div>
          <div className="shift-steps" role="group" aria-label="Adjust">
            {STEPS.map((n) => (
              <button
                key={n}
                type="button"
                className="act"
                aria-label={`${n > 0 ? 'Add' : 'Subtract'} ${Math.abs(n)} ${dayWord(n)}`}
                onClick={() => setDays((d) => d + n)}
              >
                {signed(n)}
              </button>
            ))}
          </div>
          {days !== 0 && (
            <button type="button" className="text-btn shift-reset" onClick={() => setDays(0)}>
              Reset
            </button>
          )}
        </section>

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}

        {!plan && !error && <p className="empty">Loading your {area.name} plan…</p>}

        {plan && plan.count === 0 && (
          <p className="empty">
            {tasks.length === 0
              ? `No open ${area.name} tasks to move.`
              : days === 0
                ? 'Pick how many days to shift.'
                : 'Nothing would change.'}
          </p>
        )}

        {plan && plan.count > 0 && days !== 0 && (
          <section className="shift-preview" aria-live="polite">
            <h2 className="section-title">Preview</h2>
            <div className="settings-card">
              <div className="settings-row">
                <div className="settings-text">
                  <span className="settings-name">
                    {plan.count} {plan.count === 1 ? 'task moves' : 'tasks move'}
                  </span>
                  {plan.last && (
                    <span className="settings-sub">
                      Last task: {formatDayMonth(plan.last.from)} → {formatDayMonth(plan.last.to)}
                    </span>
                  )}
                </div>
              </div>
              {plan.newEnd && (
                <div className="settings-row">
                  <div className="settings-text">
                    <span className="settings-name">Plan now finishes {formatDayMonth(plan.newEnd)}</span>
                    <span className="settings-sub">A useful guide for booking the exam.</span>
                  </div>
                </div>
              )}
            </div>

            <ul className="shift-notes">
              {plan.carriedCount > 0 && (
                <li>
                  Includes {plan.carriedCount} carried-over {plan.carriedCount === 1 ? 'task' : 'tasks'}, treated as
                  today's.
                </li>
              )}
              {plan.clampedCount > 0 && (
                <li>
                  {plan.clampedCount} {plan.clampedCount === 1 ? "task can't" : "tasks can't"} go earlier than today and{' '}
                  {plan.clampedCount === 1 ? 'lands' : 'land'} on today.
                </li>
              )}
              {shared.length > 0 && (
                <li>
                  Also in other areas:{' '}
                  {shared
                    .slice(0, 4)
                    .map(
                      (m) =>
                        `${m.task.title} (${m.task.areaIds
                          .filter((id) => id !== area.id)
                          .map((id) => areasById[id]?.name)
                          .filter(Boolean)
                          .join(', ')})`,
                    )
                    .join('; ')}
                  {shared.length > 4 ? ` and ${shared.length - 4} more` : ''}.
                </li>
              )}
              <li>Moved tasks won't show as carried over. This counts as re-planning.</li>
            </ul>
          </section>
        )}

        <div className="close-footer shift-footer">
          <button
            type="button"
            className="btn-primary"
            disabled={busy || !plan || plan.count === 0 || days === 0}
            onClick={handleShift}
          >
            {busy
              ? 'Shifting…'
              : plan && plan.count > 0 && days !== 0
                ? `Shift ${plan.count} ${plan.count === 1 ? 'task' : 'tasks'} ${signed(days)} ${dayWord(days)}`
                : 'Shift'}
          </button>
          <Link to="/week" className="text-btn centered-link">
            Cancel
          </Link>
        </div>
      </main>
    </div>
  )
}
