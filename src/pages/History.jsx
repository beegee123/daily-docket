import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import AreaChips from '../components/AreaChips.jsx'
import { CheckCircleIcon } from '../components/Icons.jsx'
import { fetchDoneSince, fetchDropped, restoreTask, saveDoneState } from '../lib/api.js'
import { daysAgo, formatPastDay, startOfLocalDayISO, toLocalISODate } from '../lib/dates.js'
import { inArea, reopenTask } from '../lib/tasks.js'

const DAYS_BACK = 30

/**
 * Look back: what you finished (last 30 days) and what you dropped.
 * Nothing here is ever deleted; done and dropped tasks just have a
 * completed_at or dropped_at stamp, so this screen only has to ask for them.
 */
export default function History({ areas, userId, onChanged, announce }) {
  const [tab, setTab] = useState('done') // 'done' | 'dropped'
  const [areaFilter, setAreaFilter] = useState(null)
  const [done, setDone] = useState(null) // null = still loading
  const [dropped, setDropped] = useState(null)
  const [error, setError] = useState(null)

  const todayISO = toLocalISODate()
  const areasById = Object.fromEntries(areas.map((a) => [a.id, a]))

  const load = useCallback(async () => {
    try {
      const since = startOfLocalDayISO(daysAgo(DAYS_BACK - 1))
      const [d, x] = await Promise.all([fetchDoneSince(since), fetchDropped()])
      setDone(d)
      setDropped(x)
      setError(null)
    } catch (e) {
      setError(e.message)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // Un-tick: the task goes back to being open (and carried over, if old)
  async function handleReopen(task) {
    setDone((prev) => prev.filter((t) => t.id !== task.id))
    try {
      await saveDoneState(reopenTask(task), userId)
      onChanged()
      announce('Back on your docket')
    } catch {
      load()
      announce("Couldn't save that. Check your connection and try again.")
    }
  }

  async function handleRestore(task) {
    setDropped((prev) => prev.filter((t) => t.id !== task.id))
    try {
      await restoreTask(task.id, todayISO)
      onChanged()
      announce('Restored to today')
    } catch {
      load()
      announce("Couldn't restore that. Check your connection and try again.")
    }
  }

  const list = (tab === 'done' ? done : dropped)?.filter((t) => inArea(t, areaFilter)) ?? null

  // Done tasks grouped by the day they were finished (local time)
  const groups = []
  if (tab === 'done' && list) {
    for (const task of list) {
      const day = toLocalISODate(new Date(task.completedAt))
      const last = groups[groups.length - 1]
      if (last && last.day === day) last.tasks.push(task)
      else groups.push({ day, tasks: [task] })
    }
  }

  return (
    <div className="screen history">
      <header className="close-header">
        <Link to="/" className="text-btn back-link">Back to today</Link>
        <span className="eyebrow">DAILY DOCKET</span>
        <h1>History</h1>
      </header>

      <div className="view-switch" role="group" aria-label="Show">
        <button
          type="button"
          className={tab === 'done' ? 'is-on' : ''}
          aria-pressed={tab === 'done'}
          onClick={() => setTab('done')}
        >
          Done{done ? ` · ${done.length}` : ''}
        </button>
        <button
          type="button"
          className={tab === 'dropped' ? 'is-on' : ''}
          aria-pressed={tab === 'dropped'}
          onClick={() => setTab('dropped')}
        >
          Dropped{dropped ? ` · ${dropped.length}` : ''}
        </button>
      </div>

      <AreaChips areas={areas} selected={areaFilter} onChange={setAreaFilter} />

      <main className="lists">
        {error && (
          <div className="form-error" role="alert">
            Couldn't load history: {error}{' '}
            <button type="button" className="link-btn" onClick={load}>
              Try again
            </button>
          </div>
        )}

        {!error && list === null && <p className="empty">Loading…</p>}

        {list && list.length === 0 && (
          <p className="empty">
            {tab === 'done'
              ? `Nothing finished in the last ${DAYS_BACK} days${areaFilter ? ' in this area' : ''}.`
              : `Nothing dropped${areaFilter ? ' in this area' : ''}.`}
          </p>
        )}

        {tab === 'done' &&
          groups.map((group) => (
            <section key={group.day}>
              <h2 className="section-title">
                {formatPastDay(group.day, todayISO)} <span className="count">{group.tasks.length} done</span>
              </h2>
              <ul className="task-list">
                {group.tasks.map((task) => (
                  <li key={task.id} className="task-row is-done">
                    <button
                      type="button"
                      className="tick"
                      aria-label={`Mark "${task.title}" not done`}
                      onClick={() => handleReopen(task)}
                    >
                      <CheckCircleIcon />
                    </button>
                    <div className="task-body">
                      <Link to={`/task/${task.id}`} className="task-title">
                        {task.title}
                      </Link>
                      <AreaLine task={task} areasById={areasById} />
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}

        {tab === 'dropped' && list && list.length > 0 && (
          <ul className="task-list">
            {list.map((task) => (
              <li key={task.id} className="task-row dropped-row">
                <div className="task-body">
                  <Link to={`/task/${task.id}`} className="task-title">
                    {task.title}
                  </Link>
                  <AreaLine task={task} areasById={areasById}>
                    <span>Dropped {formatPastDay(toLocalISODate(new Date(task.droppedAt)), todayISO).toLowerCase()}</span>
                  </AreaLine>
                </div>
                <button type="button" className="restore-btn" onClick={() => handleRestore(task)}>
                  Restore
                </button>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  )
}

function AreaLine({ task, areasById, children }) {
  return (
    <div className="task-meta">
      {task.areaIds
        .map((id) => areasById[id])
        .filter(Boolean)
        .map((area) => (
          <span key={area.id} className="area-tag">
            <span className="dot" style={{ background: area.color }} />
            {area.name}
          </span>
        ))}
      {children}
    </div>
  )
}
