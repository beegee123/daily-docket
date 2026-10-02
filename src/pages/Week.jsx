import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import AreaChips from '../components/AreaChips.jsx'
import ViewSwitch from '../components/ViewSwitch.jsx'
import { fetchEventsBetween, fetchTasksBetween } from '../lib/api.js'
import { coversDay, eventTag } from '../lib/events.js'
import { usePeople } from '../lib/people.js'
import { SuitcaseIcon } from '../components/Icons.jsx'
import { addDaysISO, dayParts, startOfWeekISO, toLocalISODate } from '../lib/dates.js'
import { inArea } from '../lib/tasks.js'

/**
 * One week at a time (Monday to Sunday), short cards per day.
 * Page forward with the arrows to plan a whole month without ever
 * seeing more than seven days at once. The week shown lives in the
 * address (?start=2026-10-05), so Back returns to the same week.
 *
 * changeSignal: App's task list. It changes whenever any task changes
 * (including live sync), which is our cue to reload this week.
 */
export default function Week({ areas, changeSignal }) {
  const todayISO = toLocalISODate()
  const thisWeek = startOfWeekISO(todayISO)

  const [params, setParams] = useSearchParams()
  const requested = params.get('start')
  // Only Mondays from this week onward; the past lives in History
  const weekStart = requested && startOfWeekISO(requested) >= thisWeek ? startOfWeekISO(requested) : thisWeek
  const weekEnd = addDaysISO(weekStart, 6)

  // The area filter lives in the address too (?area=...), so coming back
  // from a day or from Shift plan keeps it
  const requestedArea = params.get('area')
  const areaFilter = areas.some((a) => a.id === requestedArea) ? requestedArea : null
  const setAreaFilter = (id) => setParams(buildParams(weekStart, id), { replace: true })
  const [tasks, setTasks] = useState(null) // null = loading
  const [events, setEvents] = useState([])
  const { meId, people } = usePeople()
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    // Days before today are skipped: anything still open from them is
    // already on Today as a carry-over.
    const from = weekStart < todayISO ? todayISO : weekStart
    fetchTasksBetween(from, weekEnd)
      .then((rows) => {
        if (!cancelled) {
          setTasks(rows.filter((t) => t.status !== 'done'))
          setError(null)
        }
      })
      .catch((e) => !cancelled && setError(e.message))
    // Trips and events for the whole week, past days included
    fetchEventsBetween(weekStart, weekEnd)
      .then((rows) => !cancelled && setEvents(rows))
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [weekStart, weekEnd, todayISO, changeSignal])

  const shown = (tasks ?? []).filter((t) => inArea(t, areaFilter))
  const areasById = Object.fromEntries(areas.map((a) => [a.id, a]))

  const days = Array.from({ length: 7 }, (_, i) => {
    const iso = addDaysISO(weekStart, i)
    return { iso, tasks: shown.filter((t) => t.scheduledDate === iso) }
  })

  const total = shown.length
  function buildParams(start, area) {
    const next = {}
    if (start !== thisWeek) next.start = start
    if (area) next.area = area
    return next
  }
  const goTo = (start) => setParams(buildParams(start, areaFilter))
  const { day: startDay, month: startMonth } = dayParts(weekStart)
  const { day: endDay, month: endMonth } = dayParts(weekEnd)
  const range =
    startMonth === endMonth ? `${startDay} – ${endDay} ${endMonth}` : `${startDay} ${startMonth} – ${endDay} ${endMonth}`

  return (
    <div className="screen week">
      <header className="page-header">
        <div className="page-title">
          <span className="eyebrow">{weekStart === thisWeek ? 'THIS WEEK' : 'DAILY DOCKET'}</span>
          <h1>{range}</h1>
          <span className="summary">{tasks === null ? 'Loading…' : `${total} ${total === 1 ? 'task' : 'tasks'} planned`}</span>
        </div>
        <div className="header-actions">
          <Link to="/events" className="icon-btn" aria-label="Trips and events">
            <SuitcaseIcon />
          </Link>
          <button
            type="button"
            className="icon-btn"
            aria-label="Previous week"
            disabled={weekStart <= thisWeek}
            onClick={() => goTo(addDaysISO(weekStart, -7))}
          >
            <Chevron dir="left" />
          </button>
          <button type="button" className="icon-btn" aria-label="Next week" onClick={() => goTo(addDaysISO(weekStart, 7))}>
            <Chevron dir="right" />
          </button>
        </div>
      </header>

      <ViewSwitch current="week" />
      <AreaChips areas={areas} selected={areaFilter} onChange={setAreaFilter} />

      {(weekStart !== thisWeek || areaFilter) && (
        <div className="week-actions">
          {weekStart !== thisWeek ? (
            <button type="button" className="text-btn" onClick={() => goTo(thisWeek)}>
              Back to this week
            </button>
          ) : (
            <span />
          )}
          {areaFilter && (
            <Link to={`/shift/${areaFilter}`} className="text-btn">
              Shift {areasById[areaFilter].name} plan
            </Link>
          )}
        </div>
      )}

      <main className="lists">
        {error && (
          <p className="form-error" role="alert">
            Couldn't load this week: {error}
          </p>
        )}

        <ul className="week-list">
          {days.map(({ iso, tasks: dayTasks }) => {
            const { weekday, day } = dayParts(iso)
            const past = iso < todayISO
            const isToday = iso === todayISO
            const dayEvents = events.filter((ev) => coversDay(ev, iso) && (!areaFilter || ev.areaId === areaFilter))
            const preview = dayTasks.slice(0, 2)
            const more = dayTasks.length - preview.length

            const body = (
              <>
                <span className="week-date">
                  <span className="week-weekday">{weekday}</span>
                  <span className="week-day">{day}</span>
                </span>
                <span className="week-tasks">
                  {dayEvents.map((ev) => (
                    <span key={ev.id} className="week-event">
                      {eventTag(ev, meId, people)}
                    </span>
                  ))}
                  {past ? (
                    <span className="week-empty">Past · open tasks are on Today</span>
                  ) : dayTasks.length === 0 ? (
                    <span className="week-empty">Nothing planned</span>
                  ) : (
                    <>
                      {preview.map((t) => (
                        <span key={t.id} className="week-task">
                          <span
                            className="dot"
                            style={{ background: areasById[t.areaIds[0]]?.color ?? 'var(--muted)' }}
                          />
                          <span className="week-task-title">{t.title}</span>
                        </span>
                      ))}
                      {more > 0 && <span className="week-more">+ {more} more</span>}
                    </>
                  )}
                </span>
                {!past && dayTasks.length > 0 && <span className="week-count">{dayTasks.length}</span>}
              </>
            )

            return (
              <li key={iso}>
                {past ? (
                  <div className="week-card is-past">{body}</div>
                ) : (
                  <Link
                    to={isToday ? '/' : `/day/${iso}`}
                    className={`week-card${isToday ? ' is-today' : ''}`}
                    aria-label={`${weekday} ${day}: ${dayTasks.length} ${dayTasks.length === 1 ? 'task' : 'tasks'}`}
                  >
                    {body}
                  </Link>
                )}
              </li>
            )
          })}
        </ul>
      </main>
    </div>
  )
}

function Chevron({ dir }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={dir === 'left' ? 'M15 5l-7 7 7 7' : 'M9 5l7 7-7 7'} />
    </svg>
  )
}
