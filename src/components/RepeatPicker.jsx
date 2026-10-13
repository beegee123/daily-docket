import { IF_MISSED_CHOICES, TASK_REPEAT_CHOICES, WEEKDAYS, defaultDays, repeatSummary } from '../lib/repeat.js'

/**
 * "Repeats" for tasks and routines (steps 17-18): the pattern, its days,
 * an optional until date, and what happens if a copy isn't done.
 *
 * value: { repeat, repeatDays, repeatUntil, ifMissed }   (repeat null = Never)
 * startDate: the first day it can happen (weekly picks its weekday from it)
 * onChange(nextValue)
 */
export default function RepeatPicker({ value, startDate, onChange, legend = 'REPEATS' }) {
  const { repeat, repeatUntil = '', ifMissed } = value
  const needsDays = repeat === 'weekly' || repeat === 'biweekly'
  const days = needsDays ? (value.repeatDays?.length ? value.repeatDays : defaultDays(startDate)) : null
  const set = (change) => onChange({ ...value, repeatDays: days, ...change })

  function toggleDay(day) {
    set({ repeatDays: days.includes(day) ? days.filter((d) => d !== day) : [...days, day].sort() })
  }

  return (
    <fieldset className="field repeat-row">
      <legend className="field-caps">{legend}</legend>
      <div className="chip-row">
        {TASK_REPEAT_CHOICES.map(([choice, label]) => (
          <button
            key={choice ?? 'never'}
            type="button"
            className={`chip chip-lg${repeat === choice ? ' is-on' : ''}`}
            aria-pressed={repeat === choice}
            onClick={() => set({ repeat: choice })}
          >
            {label}
          </button>
        ))}
      </div>

      {needsDays && (
        <div className="chip-row weekday-row" role="group" aria-label="Which days">
          {WEEKDAYS.map(([day, short, long]) => (
            <button
              key={day}
              type="button"
              className={`chip weekday-chip${days.includes(day) ? ' is-on' : ''}`}
              aria-pressed={days.includes(day)}
              aria-label={long}
              onClick={() => toggleDay(day)}
            >
              {short.slice(0, 2)}
            </button>
          ))}
        </div>
      )}

      {repeat && (
        <>
          {(!needsDays || days.length > 0) && (
            <span className="hint">↻ {repeatSummary({ repeat, repeatDays: days, repeatUntil, startDate })}</span>
          )}

          <label className="field inline-field">
            <span className="field-caps">UNTIL · OPTIONAL</span>
            <div className="due-row">
              <input
                type="date"
                className="box-input"
                min={startDate}
                value={repeatUntil ?? ''}
                onChange={(e) => set({ repeatUntil: e.target.value })}
              />
              {repeatUntil && (
                <button type="button" className="text-btn" onClick={() => set({ repeatUntil: '' })}>
                  Clear
                </button>
              )}
            </div>
          </label>

          <div className="field inline-field">
            <span className="field-caps">IF IT ISN'T DONE</span>
            <div className="chip-row" role="group" aria-label="If it isn't done">
              {IF_MISSED_CHOICES.map(([choice, label]) => (
                <button
                  key={choice}
                  type="button"
                  className={`chip chip-lg${ifMissed === choice ? ' is-on' : ''}`}
                  aria-pressed={ifMissed === choice}
                  onClick={() => set({ ifMissed: choice })}
                >
                  {label}
                </button>
              ))}
            </div>
            <span className="hint">{IF_MISSED_CHOICES.find(([c]) => c === ifMissed)?.[2]}</span>
          </div>
        </>
      )}
    </fieldset>
  )
}

/** Checks before saving a repeat; returns a message or null. */
export function repeatProblem(value, startDate) {
  if (!value.repeat) return null
  const needsDays = value.repeat === 'weekly' || value.repeat === 'biweekly'
  const days = value.repeatDays?.length ? value.repeatDays : defaultDays(startDate)
  if (needsDays && !days.length) return 'Pick at least one day for it to repeat on.'
  if (value.repeatUntil && value.repeatUntil < startDate) return 'The until date has to be after the start.'
  return null
}

/** The days to save: what's picked, or the start date's weekday. */
export const daysToSave = (value, startDate) =>
  value.repeat === 'weekly' || value.repeat === 'biweekly'
    ? value.repeatDays?.length
      ? value.repeatDays
      : defaultDays(startDate)
    : null
