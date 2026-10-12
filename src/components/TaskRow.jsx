import { useState } from 'react'
import { Link } from 'react-router'
import { daysBetween, formatShortDate } from '../lib/dates.js'
import { CircleIcon, CheckCircleIcon, NoteIcon } from './Icons.jsx'
import { nameFor, shortName, usePeople } from '../lib/people.js'
import { parseLine } from '../lib/notes.js'
import { checklistProgress } from '../lib/week.js'
import { formatTime } from '../lib/events.js'

/**
 * One task on the docket.
 * Props:
 *   task       – the task object
 *   areasById  – lookup of area id -> area, so the row can show names and colours
 *   todayISO   – today's local date, 'YYYY-MM-DD'
 *   onToggle   – called with the task id when the circle is tapped
 *   onStep     – optional: called with (task id, line number) to tick one
 *                step of the task's checklist in place (Today only)
 */
export default function TaskRow({ task, areasById, todayISO, onToggle, onStep }) {
  const isDone = task.status === 'done'
  const daysCarried = daysBetween(task.originalDate, todayISO)
  const areas = task.areaIds.map((id) => areasById[id]).filter(Boolean)
  // In shared areas: whose job it is, who added it, who finished it
  const { meId, people } = usePeople()
  const byOther = !task.assignedTo && task.createdBy && meId && task.createdBy !== meId
  const doneByOther = isDone && task.completedBy && meId && task.completedBy !== meId
  // Steps: the checklist in the notes (a started routine, or a task like AN)
  const steps = checklistProgress(task.notes)
  const [showSteps, setShowSteps] = useState(false)
  const [askDone, setAskDone] = useState(false)

  function tickStep(line, wasChecked) {
    onStep(task.id, line)
    // Ticking the last open step: offer to finish the task
    setAskDone(!wasChecked && !isDone && steps.done + 1 === steps.total)
  }

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

          {!isDone && task.remindTime && task.scheduledDate && (
            <span className="bell-tag">🔔 {formatTime(task.remindTime)}</span>
          )}

          {steps.total > 0 && !onStep && (
            <span className="steps-count">
              {steps.done}/{steps.total} steps
            </span>
          )}

          {task.notes && steps.total === 0 && (
            <span className="note-flag" title="Has notes">
              <NoteIcon />
              <span className="visually-hidden">Has notes</span>
            </span>
          )}
        </div>

        {showSteps && (
          <ul className="step-list row-steps">
            {(task.notes ?? '').split('\n').map((text, line) => {
              const p = parseLine(text)
              if (p.kind !== 'check') return null
              return (
                <li key={line}>
                  <label className="step">
                    <input type="checkbox" checked={p.checked} onChange={() => tickStep(line, p.checked)} />
                    <span className={p.checked ? 'is-checked' : undefined}>{p.rest}</span>
                  </label>
                </li>
              )
            })}
          </ul>
        )}

        {askDone && !isDone && (
          <div className="ask-done row-ask" role="status">
            <span>All steps ticked.</span>
            <button
              type="button"
              className="restore-btn"
              onClick={() => {
                setAskDone(false)
                onToggle(task.id)
              }}
            >
              Mark done
            </button>
            <button type="button" className="text-btn" onClick={() => setAskDone(false)}>
              Not yet
            </button>
          </div>
        )}
      </div>

      {steps.total > 0 && onStep && (
        <button
          type="button"
          className="steps-btn row-steps-btn"
          aria-expanded={showSteps}
          aria-label={`${steps.done} of ${steps.total} steps. ${showSteps ? 'Hide' : 'Show'} steps`}
          onClick={() => setShowSteps((v) => !v)}
        >
          {steps.done}/{steps.total} <span aria-hidden="true">{showSteps ? '▾' : '▸'}</span>
        </button>
      )}
    </li>
  )
}
