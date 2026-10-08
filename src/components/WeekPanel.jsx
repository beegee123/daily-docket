import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { fetchWeekTasks, moveToDay, saveDoneState, saveNotes } from '../lib/api.js'
import { addDaysISO, dayParts, fromISODate, toLocalISODate } from '../lib/dates.js'
import { parseLine, toggleCheck } from '../lib/notes.js'
import { usePeople } from '../lib/people.js'
import { toggleDone } from '../lib/tasks.js'
import { checklistProgress, tasksForWeek, weekGroups } from '../lib/week.js'
import { PlusIcon } from './Icons.jsx'

/**
 * The This week panel at the top of Week: tasks planned for the week
 * rather than a day, grouped by job (area), each with a progress bar.
 * Tick tasks and their subtasks (the checklist in their notes) right here.
 */
export default function WeekPanel({ areas, weekStart, thisWeek, areaFilter, changeSignal, onChanged, announce }) {
  const { meId } = usePeople()
  const todayISO = toLocalISODate()
  const [tasks, setTasks] = useState(null) // null = loading
  const [error, setError] = useState(null)
  const [open, setOpen] = useState(() => new Set()) // tasks with their subtasks showing
  const [askDone, setAskDone] = useState(null) // task id: "all steps ticked, mark done?"
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    // Since the start of this week, local time: finished tasks show until the week ends
    const since = fromISODate(thisWeek).toISOString()
    fetchWeekTasks(weekStart, since)
      .then((rows) => {
        if (!cancelled) {
          setTasks(rows)
          setError(null)
        }
      })
      .catch((e) => !cancelled && setError(e.message))
    return () => {
      cancelled = true
    }
  }, [weekStart, thisWeek, changeSignal, reloadKey])

  const isThisWeek = weekStart === thisWeek
  const groups = tasks ? weekGroups(tasksForWeek(tasks, weekStart, thisWeek), areas, { weekStart, areaFilter }) : []

  // Change one task on screen straight away, then save; put it back if saving fails
  async function change(task, next, save, message) {
    setTasks((prev) => prev.map((t) => (t.id === task.id ? next : t)))
    try {
      await save()
      if (message) announce?.(message)
      onChanged?.()
    } catch (e) {
      setTasks((prev) => prev.map((t) => (t.id === task.id ? task : t)))
      setError(e.message)
    }
  }

  const tick = (task) => {
    const next = toggleDone(task)
    setAskDone(null)
    return change(task, next, () => saveDoneState(next, meId))
  }

  async function tickStep(task, line) {
    const notes = toggleCheck(task.notes ?? '', line)
    const steps = checklistProgress(notes)
    await change(task, { ...task, notes }, () => saveNotes(task.id, notes))
    setAskDone(steps.total > 0 && steps.done === steps.total && task.status !== 'done' ? task.id : null)
  }

  async function doToday(task) {
    setTasks((prev) => prev.filter((t) => t.id !== task.id))
    try {
      await moveToDay(task.id, todayISO)
      announce?.(`Moved to today: ${task.title}`)
      onChanged?.()
    } catch (e) {
      setError(e.message)
      setReloadKey((k) => k + 1)
    }
  }

  const toggleOpen = (id) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const { day, month } = dayParts(weekStart)
  const addLink = `/task/new?week=${weekStart}${areaFilter ? `&area=${areaFilter}` : ''}`

  return (
    <section className="week-panel" aria-labelledby="week-panel-title">
      <div className="week-panel-head">
        <h2 className="section-title" id="week-panel-title">
          {isThisWeek ? 'This week' : `Week of ${day} ${month}`}
        </h2>
        <Link to={addLink} className="text-btn add-week-link">
          <PlusIcon size={16} /> Add
        </Link>
      </div>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {tasks !== null && groups.length === 0 && (
        <p className="empty week-panel-empty">
          Nothing planned for the whole week{areaFilter ? ' in this area' : ''}. Tap Add, or choose “This week” on any
          task.
        </p>
      )}

      {groups.map((g) => {
        const pct = Math.round(g.progress * 100)
        return (
          <div key={g.area.id} className="job-card">
            <div className="job-head">
              <span className="dot" style={{ background: g.area.color }} />
              <span className="job-name">{g.area.name}</span>
              <span className="job-count">
                {g.done} of {g.total}
              </span>
            </div>
            <div
              className="job-bar"
              role="progressbar"
              aria-label={`${g.area.name} progress`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={pct}
            >
              <span style={{ width: `${pct}%`, background: g.area.color }} />
            </div>

            <ul className="job-list">
              {g.items.map(({ task, steps, carried }) => {
                const done = task.status === 'done'
                const showing = open.has(task.id)
                return (
                  <li key={task.id} className={`job-item${done ? ' is-done' : ''}`}>
                    <div className="job-row">
                      <button
                        type="button"
                        className="tick"
                        aria-pressed={done}
                        aria-label={done ? `Mark ${task.title} not done` : `Mark ${task.title} done`}
                        onClick={() => tick(task)}
                      >
                        <TickCircle done={done} />
                      </button>
                      <Link to={`/task/${task.id}`} className="job-title">
                        {task.title}
                      </Link>
                      {carried > 0 && !done && (
                        <span className="carry-badge">
                          ↻ {carried} {carried === 1 ? 'week' : 'weeks'}
                        </span>
                      )}
                      {steps.total > 0 && (
                        <button
                          type="button"
                          className="steps-btn"
                          aria-expanded={showing}
                          aria-label={`${steps.done} of ${steps.total} steps. ${showing ? 'Hide' : 'Show'} steps`}
                          onClick={() => toggleOpen(task.id)}
                        >
                          {steps.done}/{steps.total} <span aria-hidden="true">{showing ? '▾' : '▸'}</span>
                        </button>
                      )}
                      {isThisWeek && !done && (
                        <button
                          type="button"
                          className="today-btn"
                          aria-label={`Do ${task.title} today`}
                          onClick={() => doToday(task)}
                        >
                          → Today
                        </button>
                      )}
                    </div>

                    {showing && (
                      <ul className="step-list">
                        {(task.notes ?? '').split('\n').map((text, line) => {
                          const p = parseLine(text)
                          if (p.kind !== 'check') return null
                          return (
                            <li key={line}>
                              <label className="step">
                                <input type="checkbox" checked={p.checked} onChange={() => tickStep(task, line)} />
                                <span className={p.checked ? 'is-checked' : undefined}>{p.rest}</span>
                              </label>
                            </li>
                          )
                        })}
                      </ul>
                    )}

                    {askDone === task.id && (
                      <div className="ask-done" role="status">
                        <span>All steps ticked.</span>
                        <button type="button" className="restore-btn" onClick={() => tick(task)}>
                          Mark done
                        </button>
                        <button type="button" className="text-btn" onClick={() => setAskDone(null)}>
                          Not yet
                        </button>
                      </div>
                    )}

                  </li>
                )
              })}
            </ul>
          </div>
        )
      })}

      {!isThisWeek && weekStart > thisWeek && addDaysISO(weekStart, -7) === thisWeek && groups.length > 0 && (
        <p className="hint">Unfinished tasks from this week will join these on Monday.</p>
      )}
    </section>
  )
}

function TickCircle({ done }) {
  return done ? (
    <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="10.5" fill="var(--cobalt)" />
      <path d="M7.5 12.5l3 3 6-6.5" fill="none" stroke="#FFFFFF" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ) : (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="12" cy="12" r="9.5" />
    </svg>
  )
}
