import TaskRow from '../components/TaskRow.jsx'
import { MicIcon, PlusIcon, SlidersIcon } from '../components/Icons.jsx'
import { formatHeaderDate, toLocalISODate } from '../lib/dates.js'

/**
 * The Today screen.
 * Nothing here is stored as "carried over": both lists are worked out
 * from each task's dates every time the screen draws.
 */
export default function Today({ areas, tasks }) {
  const todayISO = toLocalISODate()

  // Look up areas by id instead of searching the array for every row
  const areasById = Object.fromEntries(areas.map((a) => [a.id, a]))

  const live = tasks.filter((t) => !t.droppedAt)

  // Open = not done, and on the docket today or earlier.
  // 'YYYY-MM-DD' strings compare correctly as text.
  const open = live.filter((t) => t.status !== 'done' && t.scheduledDate <= todayISO)

  // Carried over = open tasks first put on a docket before today, oldest first
  const carried = open
    .filter((t) => t.originalDate < todayISO)
    .sort((a, b) => a.originalDate.localeCompare(b.originalDate))

  const todayOnly = open.filter((t) => t.originalDate >= todayISO)

  const doneToday = live.filter(
    (t) => t.status === 'done' && t.completedAt && toLocalISODate(new Date(t.completedAt)) === todayISO,
  )

  const total = open.length + doneToday.length
  const rowProps = { areasById, todayISO }

  return (
    <div className="screen">
      <header className="page-header">
        <div className="page-title">
          <span className="eyebrow">DAILY DOCKET</span>
          <h1>{formatHeaderDate()}</h1>
          <span className="summary">
            {doneToday.length} of {total} done · {carried.length} carried over
          </span>
        </div>
        <div className="header-actions">
          <button type="button" className="icon-btn" aria-label="Areas and settings">
            <SlidersIcon />
          </button>
          <button type="button" className="btn-dark">Close day</button>
        </div>
      </header>

      <nav className="view-switch" aria-label="Views">
        <a href="#" className="is-on" aria-current="page">Today</a>
        <a href="#">Week</a>
        <a href="#">Routines</a>
      </nav>

      {/* Filtering works in step 3; for now "All" is always on */}
      <div className="chips" role="group" aria-label="Filter by area">
        <button type="button" className="chip is-on">All</button>
        {areas.map((area) => (
          <button type="button" key={area.id} className="chip">
            <span className="dot" style={{ background: area.color }} />
            {area.name}
          </button>
        ))}
      </div>

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
            <p className="empty">Nothing new for today.</p>
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
      </main>

      {/* Quick capture works in step 6 */}
      <form className="capture-bar" onSubmit={(e) => e.preventDefault()}>
        <label className="visually-hidden" htmlFor="capture">Add a task</label>
        <input id="capture" placeholder="Add a task… “call bank, Home, Fri”" autoComplete="off" />
        <button type="button" className="capture-icon" aria-label="Speak a task">
          <MicIcon />
        </button>
        <button type="submit" className="capture-add" aria-label="Add task">
          <PlusIcon />
        </button>
      </form>
    </div>
  )
}
