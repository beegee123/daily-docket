import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { PlusIcon, SuitcaseIcon } from '../components/Icons.jsx'
import { fetchUpcomingEvents } from '../lib/api.js'
import { toLocalISODate } from '../lib/dates.js'
import { eventDates } from '../lib/events.js'
import { shortName, usePeople } from '../lib/people.js'

/** Trips and events that aren't over yet, soonest first. */
export default function Events({ areas, changeSignal }) {
  const todayISO = toLocalISODate()
  const { meId, people } = usePeople()
  const [events, setEvents] = useState(null)
  const [error, setError] = useState(null)
  const areasById = Object.fromEntries(areas.map((a) => [a.id, a]))

  useEffect(() => {
    let cancelled = false
    fetchUpcomingEvents(todayISO)
      .then((rows) => !cancelled && (setEvents(rows), setError(null)))
      .catch((e) => !cancelled && setError(e.message))
    return () => {
      cancelled = true
    }
  }, [todayISO, changeSignal])

  return (
    <div className="screen events-screen">
      <header className="close-header">
        <Link to="/week" className="text-btn back-link">Back to week</Link>
        <span className="eyebrow">DAILY DOCKET</span>
        <h1>Trips &amp; events</h1>
        <p className="lead">Shown to everyone in the area. They never carry over.</p>
      </header>

      <main className="lists">
        {error && (
          <p className="form-error" role="alert">
            Couldn't load trips and events: {error}
          </p>
        )}
        {!error && events === null && <p className="empty">Loading…</p>}
        {events && events.length === 0 && <p className="empty">Nothing coming up.</p>}

        {events && events.length > 0 && (
          <ul className="task-list">
            {events.map((ev) => {
              const area = areasById[ev.areaId]
              const now = ev.startDate <= todayISO
              return (
                <li key={ev.id}>
                  <Link to={`/events/${ev.id}`} className={`event-row${now ? ' is-now' : ''}`}>
                    <span className="event-icon" aria-hidden="true">
                      <SuitcaseIcon size={18} />
                    </span>
                    <span className="event-text">
                      <span className="settings-name">{ev.title}</span>
                      <span className="task-meta">
                        <span>{eventDates(ev)}</span>
                        {ev.personId && (
                          <span className="who-tag">
                            {ev.personId === meId ? 'You' : shortName(people[ev.personId])} away
                          </span>
                        )}
                        {area && (
                          <span className="area-tag">
                            <span className="dot" style={{ background: area.color }} />
                            {area.name}
                          </span>
                        )}
                        {now && <span className="carry-badge">Now</span>}
                      </span>
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}

        <Link to="/events/new" className="btn-secondary as-link add-on-day">
          <PlusIcon size={18} /> Add a trip or event
        </Link>
      </main>
    </div>
  )
}
