import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { timeRange, shortTime } from '../lib/events.js'
import { eventLink, isRepeating, occurrenceKey } from '../lib/repeat.js'
import {
  allOver,
  isAttended,
  isOver,
  nowLineIndex,
  nowMinutes,
  remindLabel,
  scheduleSummary,
  soonLabel,
} from '../lib/schedule.js'

const STORE_KEY = 'docket.scheduleOpen'

// Open or folded is remembered on this device. Private browsing can refuse.
function readOpen() {
  try {
    return localStorage.getItem(STORE_KEY) !== 'false'
  } catch {
    return true
  }
}
function writeOpen(open) {
  try {
    localStorage.setItem(STORE_KEY, String(open))
  } catch {
    // not remembered; fine
  }
}

/** The clock, updated every minute, so past meetings fade on their own. */
function useNow() {
  const [now, setNow] = useState(() => nowMinutes())
  useEffect(() => {
    const timer = setInterval(() => setNow(nowMinutes()), 30 * 1000)
    return () => clearInterval(timer)
  }, [])
  return now
}

/**
 * Schedule on Today: today's meetings from every area, in time order.
 * Tick one to mark it attended (for you only). Tap the heading to fold it
 * to one line; it folds itself once every meeting is over or ticked.
 */
export default function Schedule({ meetings, areasById, attended, onAttend }) {
  const now = useNow()
  const [stored, setStored] = useState(readOpen)
  // A tap while everything is over opens it anyway, until the next visit
  const [override, setOverride] = useState(null)
  const done = allOver(meetings, now, attended)
  const open = override ?? (done ? false : stored)

  const toggle = () => {
    setStored(!open)
    writeOpen(!open)
    setOverride(!open)
  }

  const lineAt = nowLineIndex(meetings, now)
  const nowText = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase()

  return (
    <section className={`schedule${open ? ' is-open' : ''}`}>
      <h2 className="section-title schedule-title">
        <button
          type="button"
          className="schedule-toggle"
          aria-expanded={open}
          aria-controls="schedule-list"
          onClick={toggle}
        >
          <span>Schedule</span>
          <span aria-hidden="true" className="chevron job-chevron">
            ›
          </span>
        </button>
        {open && (
          <span className="count">
            {meetings.length} {meetings.length === 1 ? 'meeting' : 'meetings'}
          </span>
        )}
      </h2>

      {!open && (
        <button type="button" className="schedule-folded" onClick={toggle}>
          {scheduleSummary(meetings, now, attended)}
        </button>
      )}

      {open && (
        <ul id="schedule-list" className="schedule-list">
          {meetings.map((ev, i) => {
            const area = areasById[ev.areaId]
            const ticked = isAttended(ev, attended)
            const over = isOver(ev, now, attended)
            const soon = ticked ? null : soonLabel(ev, now)
            return (
              <li key={occurrenceKey(ev)} className={`meeting${over ? ' is-over' : ''}${ticked ? ' is-ticked' : ''}`}>
                {i === lineAt && (
                  <div className="now-line" aria-hidden="true">
                    <span>NOW {nowText}</span>
                  </div>
                )}
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
                        {soon ? (
                          <span className="bell-tag is-soon">🔔 {soon}</span>
                        ) : (
                          ev.remindMinutes != null &&
                          !over && <span className="bell-tag">🔔 {remindLabel(ev.remindMinutes)}</span>
                        )}
                      </span>
                    </span>
                  </Link>
                  <button
                    type="button"
                    className="meeting-tick"
                    aria-pressed={ticked}
                    aria-label={ticked ? `${ev.title}: attended. Tap to untick.` : `Mark ${ev.title} as attended`}
                    onClick={() => onAttend(ev)}
                  >
                    {ticked ? '✓' : ''}
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
