import { useEffect, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router'
import TaskRow from '../components/TaskRow.jsx'
import { PlusIcon } from '../components/Icons.jsx'
import { fetchEventsBetween, fetchTasksBetween, saveDoneState } from '../lib/api.js'
import { formatLongDay, startOfWeekISO, toLocalISODate } from '../lib/dates.js'
import { toggleDone } from '../lib/tasks.js'
import { eventBanner, shortTime, timeRange } from '../lib/events.js'
import { eventLink, isRepeating } from '../lib/repeat.js'
import { bannerEvents, meetingsFor, remindLabel } from '../lib/schedule.js'
import { usePeople } from '../lib/people.js'

/**
 * One future day, opened from the Week screen: its meetings (each opens
 * that date, so one date of a repeating meeting can be changed ahead of
 * time), its trips and all-day events, and every task planned for it.
 */
export default function Day({ areas, userId, changeSignal, onChanged, announce }) {
  const { date } = useParams()
  const todayISO = toLocalISODate()
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(date ?? '')

  const [tasks, setTasks] = useState(null)
  const [error, setError] = useState(null)
  const [events, setEvents] = useState([])
  const { meId, people } = usePeople()

  useEffect(() => {
    if (!valid || date <= todayISO) return
    let cancelled = false
    fetchTasksBetween(date, date)
      .then((rows) => !cancelled && (setTasks(rows), setError(null)))
      .catch((e) => !cancelled && setError(e.message))
    fetchEventsBetween(date, date)
      .then((rows) => !cancelled && setEvents(rows))
      .catch(() => !cancelled && setEvents([]))
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
  const meetings = meetingsFor(events, date)
  const banners = bannerEvents(events, date)

  return (
    <div className="screen day">
      <header className="close-header">
        <Link to={weekLink} className="text-btn back-link">
          Back to week
        </Link>
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

        {banners.length > 0 && (
          <ul className="event-banners day-banners" aria-label="Trips and events this day">
            {banners.map((ev) => (
              <li key={ev.id}>
                <Link to={eventLink(ev)} className="event-banner">
                  <span className="event-banner-text">
                    {eventBanner(ev, date, meId, people).replace(/^Today[:·] ?/, '')}
                  </span>
                  {areasById[ev.areaId] && <span className="event-banner-area">{areasById[ev.areaId].name}</span>}
                </Link>
              </li>
            ))}
          </ul>
        )}

        {meetings.length > 0 && (
          <section>
            <h2 className="section-title">
              Schedule{' '}
              <span className="count">
                {meetings.length} {meetings.length === 1 ? 'meeting' : 'meetings'}
              </span>
            </h2>
            <ul className="schedule-list">
              {meetings.map((ev) => {
                const area = areasById[ev.areaId]
                return (
                  <li key={ev.id} className="meeting">
                    <div className="meeting-row">
                      <Link to={eventLink(ev)} className="meeting-link">
                        <span className="meeting-time">{shortTime(ev.startTime)}</span>
                        <span className="meeting-bar" style={{ background: area?.color ?? 'var(--line)' }} />
                        <span className="meeting-body">
                          <span className="meeting-title">{ev.title}</span>
                          <span className="meeting-meta">
                            {timeRange(ev)}
                            {area && ` · ${area.name}`}
                            {isRepeating(ev) && <span aria-label="Repeats">↻</span>}
                            {ev.remindMinutes != null && (
                              <span className="bell-tag">🔔 {remindLabel(ev.remindMinutes)}</span>
                            )}
                          </span>
                        </span>
                      </Link>
                      <span aria-hidden="true" className="chevron meeting-chevron">
                        ›
                      </span>
                    </div>
                  </li>
                )
              })}
            </ul>
            <p className="hint">
              Tap a meeting to change it. For one that repeats, you'll choose this date only or this and later ones.
            </p>
          </section>
        )}

        {meetings.length > 0 && <h2 className="section-title">Tasks</h2>}
        {tasks && open.length === 0 && <p className="empty">Nothing planned for this day yet.</p>}

        {open.length > 0 && (
          <ul className="task-list">
            {open.map((t) => (
              <TaskRow key={t.id} task={t} {...rowProps} />
            ))}
          </ul>
        )}

        {done.length > 0 && (
          <section>
            <h2 className="section-title">
              Already done <span className="count">{done.length}</span>
            </h2>
            <ul className="task-list">
              {done.map((t) => (
                <TaskRow key={t.id} task={t} {...rowProps} />
              ))}
            </ul>
          </section>
        )}

        <Link to={`/task/new?date=${date}`} className="btn-secondary as-link add-on-day">
          <PlusIcon size={18} /> Add a task on this day
        </Link>
        <Link to={`/events/new?date=${date}`} className="text-btn add-on-day-event">
          Add a meeting or event on this day
        </Link>
      </main>
    </div>
  )
}
