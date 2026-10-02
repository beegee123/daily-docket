import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import AreaChips from '../components/AreaChips.jsx'
import TaskRow from '../components/TaskRow.jsx'
import ViewSwitch from '../components/ViewSwitch.jsx'
import { MicIcon, PlusIcon, SlidersIcon } from '../components/Icons.jsx'
import { formatHeaderDate, toLocalISODate } from '../lib/dates.js'
import { inArea, isCarried, isDoneOn, isForMe, isOpen } from '../lib/tasks.js'
import { isShared, usePeople } from '../lib/people.js'

/**
 * The Today screen.
 * Only two things are stored: the tasks (in App) and which area chip is
 * selected (here). Every list below is worked out from those each time
 * the screen draws, so the lists can never disagree with the tasks.
 */
export default function Today({ areas, tasks, onToggle, closure, onReopen, userEmail, onSignOut }) {
  const [areaFilter, setAreaFilter] = useState(null) // null = All
  const navigate = useNavigate()

  const todayISO = toLocalISODate()
  const areasById = Object.fromEntries(areas.map((a) => [a.id, a]))

  // Header counts cover the whole day, whatever the filter
  const openCount = tasks.filter((t) => isOpen(t, todayISO)).length
  const doneCount = tasks.filter((t) => isDoneOn(t, todayISO)).length
  const carriedCount = tasks.filter((t) => isCarried(t, todayISO)).length

  // The lists respect the selected area
  // "Mine": hide tasks assigned to someone else. Only offered once
  // something is shared, since before that everything is yours anyway.
  const { meId, areaPeople } = usePeople()
  const anyShared = areas.some((a) => isShared(areaPeople, a.id))
  const [mineOnly, setMineOnly] = useState(false)
  const shown = tasks.filter((t) => inArea(t, areaFilter) && (!mineOnly || !anyShared || isForMe(t, meId)))

  const carried = shown
    .filter((t) => isCarried(t, todayISO))
    .sort((a, b) => a.originalDate.localeCompare(b.originalDate))

  const todayOnly = shown.filter((t) => isOpen(t, todayISO) && !isCarried(t, todayISO))

  const doneToday = shown
    .filter((t) => isDoneOn(t, todayISO))
    .sort((a, b) => b.completedAt.localeCompare(a.completedAt)) // most recent first

  const rowProps = { areasById, todayISO, onToggle }
  const [reopening, setReopening] = useState(false)
  const filterName = areaFilter ? areasById[areaFilter].name : null

  return (
    <div className="screen">
      <header className="page-header">
        <div className="page-title">
          <span className="eyebrow">DAILY DOCKET</span>
          <h1>{formatHeaderDate()}</h1>
          <span className="summary">
            {doneCount} of {openCount + doneCount} done · {carriedCount} carried over
          </span>
        </div>
        <div className="header-actions">
          <Link to="/settings" className="icon-btn" aria-label="Settings">
            <SlidersIcon />
          </Link>
          <Link to="/close" className="btn-dark as-link">Close day</Link>
        </div>
      </header>

      <ViewSwitch current="today" />

      <AreaChips
        areas={areas}
        selected={areaFilter}
        onChange={setAreaFilter}
        mine={anyShared ? { on: mineOnly, onToggle: () => setMineOnly((v) => !v) } : null}
      />

      {closure && (
        <div className="closed-bar" role="status">
          <span>
            Day closed at{' '}
            {new Date(closure.closedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
          </span>
          <button
            type="button"
            className="text-btn"
            disabled={reopening}
            onClick={async () => {
              setReopening(true)
              await onReopen(closure.id)
              setReopening(false)
            }}
          >
            {reopening ? 'Reopening…' : 'Reopen'}
          </button>
        </div>
      )}

      <main className="lists">
        {carried.length > 0 && (
          <section>
            <h2 className="section-title">
              Carried over <span className="count">{carried.length}</span>
            </h2>
            <ul className="task-list">
              {carried.map((t) => <TaskRow key={t.id} task={t} {...rowProps} />)}
            </ul>
          </section>
        )}

        <section>
          <h2 className="section-title">
            Today <span className="count">{todayOnly.length} open</span>
          </h2>
          {todayOnly.length > 0 ? (
            <ul className="task-list">
              {todayOnly.map((t) => <TaskRow key={t.id} task={t} {...rowProps} />)}
            </ul>
          ) : (
            <p className="empty">
              {filterName ? `Nothing new in ${filterName} today.` : 'Nothing new for today.'}
            </p>
          )}
        </section>

        {doneToday.length > 0 && (
          <section>
            <h2 className="section-title">
              Done today <span className="count">{doneToday.length}</span>
            </h2>
            <ul className="task-list">
              {doneToday.map((t) => <TaskRow key={t.id} task={t} {...rowProps} />)}
            </ul>
          </section>
        )}

        <footer className="today-footer">
          <Link to="/history" className="history-link">History: done and dropped tasks</Link>
          <p className="signed-in">
            Signed in as {userEmail} ·{' '}
            <button type="button" className="link-btn" onClick={onSignOut}>
              Sign out
            </button>
          </p>
        </footer>
      </main>

      {/* For now, typing then pressing Enter opens the form with the title
          filled in. Step 11 teaches it to read "call bank, Home, Fri". */}
      <form
        className="capture-bar"
        onSubmit={(e) => {
          e.preventDefault()
          const text = e.currentTarget.elements.capture.value.trim()
          navigate(text ? `/task/new?title=${encodeURIComponent(text)}` : '/task/new')
        }}
      >
        <label className="visually-hidden" htmlFor="capture">Add a task</label>
        <input id="capture" placeholder="Add a task… “call bank, Home, Fri”" autoComplete="off" />
        <button type="button" className="capture-icon" aria-label="Speak a task">
          <MicIcon />
        </button>
        <Link to="/task/new" className="capture-add" aria-label="New task">
          <PlusIcon />
        </Link>
      </form>
    </div>
  )
}
