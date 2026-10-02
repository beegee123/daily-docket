import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { closeDayWithRecord } from '../lib/api.js'
import { daysBetween, daysFromToday, formatShortDate, toLocalISODate } from '../lib/dates.js'
import { isCarried, isDoneOn, isMyJob, isOpen } from '../lib/tasks.js'

/**
 * Close the day: decide where each open task goes.
 * Every task starts on "Tomorrow", so one tap on Confirm rolls
 * everything forward. Nothing is saved until Confirm.
 */
export default function CloseDay({ areas, tasks, userId, onClosed }) {
  const navigate = useNavigate()
  const todayISO = toLocalISODate()
  const tomorrowISO = daysFromToday(1)
  const areasById = Object.fromEntries(areas.map((a) => [a.id, a]))

  // Carry-overs first (oldest first), then today's
  // Only your jobs: assigned to you, or unassigned and added by you.
  // Closing your day never moves someone else's task.
  const othersOpen = tasks.filter((t) => isOpen(t, todayISO) && !isMyJob(t, userId)).length
  const open = tasks
    .filter((t) => isOpen(t, todayISO) && isMyJob(t, userId))
    .sort((a, b) => {
      const ac = isCarried(a, todayISO)
      const bc = isCarried(b, todayISO)
      if (ac !== bc) return ac ? -1 : 1
      return a.originalDate.localeCompare(b.originalDate)
    })
  const doneCount = tasks.filter((t) => isDoneOn(t, todayISO)).length

  // One choice per task: { action: 'tomorrow' | 'pick' | 'drop', date }
  const [choices, setChoices] = useState(() =>
    Object.fromEntries(open.map((t) => [t.id, { action: 'tomorrow', date: tomorrowISO }])),
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const choose = (taskId, change) =>
    setChoices((prev) => ({ ...prev, [taskId]: { ...prev[taskId], ...change } }))

  // A task that arrived after this screen opened (say, from another
  // device) is simply left alone; it will carry over on its own.
  const choiceFor = (taskId) => choices[taskId]

  async function handleConfirm() {
    const items = open
      .filter((t) => choiceFor(t.id))
      .map((t) => {
        const c = choiceFor(t.id)
        if (c.action === 'drop') return { id: t.id, action: 'drop' }
        return { id: t.id, action: 'move', date: c.action === 'tomorrow' ? tomorrowISO : c.date }
      })

    if (items.some((i) => i.action === 'move' && !i.date)) {
      setError('Pick a day for every task set to "Pick day".')
      return
    }

    // What Undo needs: each task's day before we touch it
    const undoItems = items.map((item) => {
      const before = open.find((t) => t.id === item.id)
      return item.action === 'drop'
        ? { id: item.id, action: 'restore', date: before.scheduledDate }
        : { id: item.id, action: 'move', date: before.scheduledDate }
    })

    setBusy(true)
    setError(null)
    try {
      const { moved, dropped, closureId } = await closeDayWithRecord(items, todayISO, undoItems)
      const parts = []
      if (moved) parts.push(`${moved} moved`)
      if (dropped) parts.push(`${dropped} dropped`)
      onClosed(parts.length ? `Day closed · ${parts.join(', ')}` : 'Day closed', closureId)
      navigate('/')
    } catch (e) {
      setError(e.message)
      setBusy(false)
    }
  }

  return (
    <div className="screen close-day">
      <header className="close-header">
        <Link to="/" className="text-btn back-link">Back to today</Link>
        <span className="eyebrow">DAILY DOCKET</span>
        <h1>Close the day</h1>
        <p className="lead">
          {open.length === 0
            ? `${doneCount} done and nothing left open.`
            : `${doneCount} done, ${open.length} still open. Choose where each one goes, or roll them all to tomorrow.`}
        </p>
        {othersOpen > 0 && (
          <p className="hint">
            {othersOpen} shared {othersOpen === 1 ? 'task' : 'tasks'} for someone else {othersOpen === 1 ? "isn't" : "aren't"} included.
          </p>
        )}
      </header>

      {open.length === 0 ? (
        <div className="close-empty">
          <Link to="/" className="btn-primary as-link">Back to today</Link>
        </div>
      ) : (
        <>
          <ul className="close-list">
            {open.map((task) => {
              const c = choiceFor(task.id) ?? { action: 'tomorrow', date: tomorrowISO }
              const days = daysBetween(task.originalDate, todayISO)
              const taskAreas = task.areaIds.map((id) => areasById[id]).filter(Boolean)
              const groupLabel = `Where should "${task.title}" go?`

              return (
                <li key={task.id} className="close-card">
                  <div className="close-card-top">
                    <span className="task-title">{task.title}</span>
                    <div className="task-meta">
                      {taskAreas.map((area) => (
                        <span key={area.id} className="area-tag">
                          <span className="dot" style={{ background: area.color }} />
                          {area.name}
                        </span>
                      ))}
                      {days > 0 && (
                        <span className="carry-badge">
                          ↻ {days} {days === 1 ? 'day' : 'days'}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="acts" role="group" aria-label={groupLabel}>
                    <button
                      type="button"
                      className={`act${c.action === 'tomorrow' ? ' is-on' : ''}`}
                      aria-pressed={c.action === 'tomorrow'}
                      onClick={() => choose(task.id, { action: 'tomorrow' })}
                    >
                      Tomorrow
                    </button>
                    <button
                      type="button"
                      className={`act${c.action === 'pick' ? ' is-on' : ''}`}
                      aria-pressed={c.action === 'pick'}
                      onClick={() => choose(task.id, { action: 'pick', date: c.date || tomorrowISO })}
                    >
                      {c.action === 'pick' && c.date ? formatShortDate(c.date, todayISO) : 'Pick day'}
                    </button>
                    <button
                      type="button"
                      className={`act act-drop${c.action === 'drop' ? ' is-on' : ''}`}
                      aria-pressed={c.action === 'drop'}
                      onClick={() => choose(task.id, { action: 'drop' })}
                    >
                      Drop
                    </button>
                  </div>

                  {c.action === 'pick' && (
                    <label className="field">
                      <span className="visually-hidden">New day for {task.title}</span>
                      <input
                        type="date"
                        className="box-input"
                        min={tomorrowISO}
                        value={c.date}
                        onChange={(e) => choose(task.id, { date: e.target.value })}
                      />
                    </label>
                  )}
                </li>
              )
            })}
          </ul>

          <div className="close-footer">
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <button type="button" className="btn-primary" onClick={handleConfirm} disabled={busy}>
              {busy ? 'Closing…' : 'Confirm and close the day'}
            </button>
            <p className="hint centered">Skip this and open tasks still roll forward on their own.</p>
          </div>
        </>
      )}
    </div>
  )
}
