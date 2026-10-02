import { Link } from 'react-router'
import { daysBetween, formatShortDate } from '../lib/dates.js'
import { CircleIcon, CheckCircleIcon, NoteIcon } from './Icons.jsx'
import { nameFor, shortName, usePeople } from '../lib/people.js'

/**
 * One task on the docket.
 * Props:
 *   task       – the task object
 *   areasById  – lookup of area id -> area, so the row can show names and colours
 *   todayISO   – today's local date, 'YYYY-MM-DD'
 *   onToggle   – called with the task id when the circle is tapped
 */
export default function TaskRow({ task, areasById, todayISO, onToggle }) {
  const isDone = task.status === 'done'
  const daysCarried = daysBetween(task.originalDate, todayISO)
  const areas = task.areaIds.map((id) => areasById[id]).filter(Boolean)
  // In shared areas: whose job it is, who added it, who finished it
  const { meId, people } = usePeople()
  const byOther = !task.assignedTo && task.createdBy && meId && task.createdBy !== meId
  const doneByOther = isDone && task.completedBy && meId && task.completedBy !== meId

  return (
    <li className={`task-row${isDone ? ' is-done' : ''}`}>
      <button
        type="button"
        className="tick"
        aria-pressed={isDone}
        aria-label={isDone ? `Mark "${task.title}" not done` : `Mark "${task.title}" done`}
        onClick={() => onToggle(task.id)}
      >
        {isDone ? <CheckCircleIcon /> : <CircleIcon />}
      </button>

      <div className="task-body">
        <Link to={`/task/${task.id}`} className="task-title">
          {task.title}
        </Link>

        <div className="task-meta">
          {areas.map((area) => (
            <span key={area.id} className="area-tag">
              <span className="dot" style={{ background: area.color }} />
              {area.name}
            </span>
          ))}

          {!isDone && daysCarried > 0 && (
            <span className="carry-badge">
              ↻ {daysCarried} {daysCarried === 1 ? 'day' : 'days'}
            </span>
          )}

          {task.assignedTo && !isDone && (
            <span className={`who-tag${task.assignedTo === meId ? ' is-me' : ''}`}>
              → {nameFor(task.assignedTo, meId, people)}
            </span>
          )}
          {byOther && <span className="who-tag">by {shortName(people[task.createdBy])}</span>}
          {doneByOther && <span className="who-tag">✓ by {shortName(people[task.completedBy])}</span>}

          {task.status === 'doing' && <span>In progress</span>}

          {!isDone && task.dueDate && <span>Due {formatShortDate(task.dueDate, todayISO)}</span>}

          {task.notes && (
            <span className="note-flag" title="Has notes">
              <NoteIcon />
              <span className="visually-hidden">Has notes</span>
            </span>
          )}
        </div>
      </div>
    </li>
  )
}
