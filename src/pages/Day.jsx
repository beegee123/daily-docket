import { useEffect, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router'
import TaskRow from '../components/TaskRow.jsx'
import { PlusIcon } from '../components/Icons.jsx'
import { fetchTasksBetween, saveDoneState } from '../lib/api.js'
import { formatLongDay, startOfWeekISO, toLocalISODate } from '../lib/dates.js'
import { toggleDone } from '../lib/tasks.js'

/** Every task on one future day, opened from the Week screen. */
export default function Day({ areas, userId, changeSignal, onChanged, announce }) {
  const { date } = useParams()
  const todayISO = toLocalISODate()
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(date ?? '')

  const [tasks, setTasks] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!valid || date <= todayISO) return
    let cancelled = false
    fetchTasksBetween(date, date)
      .then((rows) => !cancelled && (setTasks(rows), setError(null)))
      .catch((e) => !cancelled && setError(e.message))
    return () => {
      cancelled = true
    }
  }, [date, valid, todayISO, changeSignal])

  // Today (or a past day) lives on the Today screen
  if (!valid || date <= todayISO) return <Navigate to="/" replace />

  const areasById = Object.fromEntries(areas.map((a) => [a.id, a]))
  const weekLink = startOfWeekISO(date) === startOfWeekISO(todayISO) ? '/week' : `/week?start=${startOfWeekISO(date)}`

  async function handleToggle(taskId) {
    const before = tasks.find((t) => t.id === taskId)
    if (!before) return
    const after = toggleDone(before)
    setTasks((prev) => prev.map((t) => (t.id === taskId ? after : t)))
    try {
      await saveDoneState(after, userId)
      onChanged()
    } catch {
      setTasks((prev) => prev.map((t) => (t.id === taskId ? before : t)))
      announce("Couldn't save that. Check your connection and try again.")
    }
  }

  const open = (tasks ?? []).filter((t) => t.status !== 'done')
  const done = (tasks ?? []).filter((t) => t.status === 'done')
  const rowProps = { areasById, todayISO, onToggle: handleToggle }

  return (
    <div className="screen day">
      <header className="close-header">
        <Link to={weekLink} className="text-btn back-link">Back to week</Link>
        <span className="eyebrow">DAILY DOCKET</span>
        <h1>{formatLongDay(date)}</h1>
        <p className="lead">
          {tasks === null ? 'Loading…' : `${open.length} ${open.length === 1 ? 'task' : 'tasks'} planned`}
        </p>
      </header>

      <main className="lists">
        {error && (
          <p className="form-error" role="alert">
            Couldn't load this day: {error}
          </p>
        )}

        {tasks && open.length === 0 && <p className="empty">Nothing planned for this day yet.</p>}

        {open.length > 0 && (
          <ul className="task-list">
            {open.map((t) => <TaskRow key={t.id} task={t} {...rowProps} />)}
          </ul>
        )}

        {done.length > 0 && (
          <section>
            <h2 className="section-title">
              Already done <span className="count">{done.length}</span>
            </h2>
            <ul className="task-list">
              {done.map((t) => <TaskRow key={t.id} task={t} {...rowProps} />)}
            </ul>
          </section>
        )}

        <Link to={`/task/new?date=${date}`} className="btn-secondary as-link add-on-day">
          <PlusIcon size={18} /> Add a task on this day
        </Link>
      </main>
    </div>
  )
}
