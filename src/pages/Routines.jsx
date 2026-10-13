import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import AreaChips from '../components/AreaChips.jsx'
import ViewSwitch from '../components/ViewSwitch.jsx'
import { PlusIcon } from '../components/Icons.jsx'
import { fetchRepeatRules, fetchRoutines, startRoutine } from '../lib/api.js'
import { daysFromToday, formatShortDate, startOfWeekISO, toLocalISODate } from '../lib/dates.js'
import { routineMeta } from '../lib/routines.js'
import { nextOccurrence, repeatSummary } from '../lib/repeat.js'
import { supabase } from '../lib/supabase.js'

/**
 * Routines: saved checklists you run again and again (Guest turnover,
 * Monday work setup). Each card opens to show its steps and Start buttons.
 * Starting one adds a single task named after it, with its steps as a
 * checklist (supabase/020_start_routine.sql). A routine can also repeat
 * on a schedule; below them, Repeating tasks lists the plain tasks that
 * repeat (supabase/023_repeat_rules.sql).
 */
export default function Routines({ areas, onStarted, announce }) {
  const [routines, setRoutines] = useState(null) // null = loading
  const [error, setError] = useState(null)
  const [areaFilter, setAreaFilter] = useState(null)
  const [open, setOpen] = useState(() => new Set())
  const [busy, setBusy] = useState(null) // id of the routine being started
  const [pickingDay, setPickingDay] = useState(null) // id whose "Other day" picker is showing
  const [rules, setRules] = useState([]) // every repeat: routines' and tasks'
  const todayISO = toLocalISODate()

  async function start(routine, { day = null, week = null }, label) {
    setBusy(routine.id)
    setError(null)
    try {
      await startRoutine(routine.id, { day, week })
      setPickingDay(null)
      onStarted?.()
      announce?.(`${routine.name} added to ${label}`)
      load()
    } catch (e) {
      setError(e.message)
    }
    setBusy(null)
  }

  const load = useCallback(() => {
    fetchRoutines()
      .then((rows) => {
        setRoutines(rows)
        setError(null)
      })
      .catch((e) => setError(e.message))
    // Before SQL 023 there are no repeats; the screen works without them
    fetchRepeatRules()
      .then(setRules)
      .catch(() => setRules([]))
  }, [])

  // Load, and reload when anyone sharing an area changes a routine
  useEffect(() => {
    load()
    if (!supabase) return
    const channel = supabase
      .channel('routines-screen')
      .on('postgres_changes', { event: '*', schema: 'docket', table: 'routines' }, load)
      .on('postgres_changes', { event: '*', schema: 'docket', table: 'repeat_rules' }, load)
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [load])

  const areasById = Object.fromEntries(areas.map((a) => [a.id, a]))
  // Group by area, in your area order
  const shown = (routines ?? []).filter((r) => areasById[r.areaId] && (!areaFilter || r.areaId === areaFilter))
  const order = new Map(areas.map((a, i) => [a.id, i]))
  shown.sort((a, b) => order.get(a.areaId) - order.get(b.areaId) || a.name.localeCompare(b.name))

  const ruleFor = Object.fromEntries(rules.filter((r) => r.routineId).map((r) => [r.routineId, r]))
  const taskRules = rules
    .filter((r) => !r.routineId && areasById[r.areaId] && (!areaFilter || r.areaId === areaFilter))
    .map((r) => ({ ...r, next: nextOccurrence(r, todayISO) }))
    .sort((a, b) => (a.next ?? '9999').localeCompare(b.next ?? '9999') || a.title.localeCompare(b.title))

  const toggle = (id) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const newLink = areaFilter ? `/routines/new?area=${areaFilter}` : '/routines/new'

  return (
    <div className="screen routines-screen">
      <header className="page-header">
        <div className="page-title">
          <span className="eyebrow">DAILY DOCKET</span>
          <h1>Routines</h1>
          <span className="summary">
            {routines === null
              ? 'Loading…'
              : `${shown.length} ${shown.length === 1 ? 'routine' : 'routines'} · checklists you run again and again`}
          </span>
        </div>
        <div className="header-actions">
          <Link to={newLink} className="btn-dark as-link">
            <PlusIcon size={16} /> New
          </Link>
        </div>
      </header>

      <ViewSwitch current="routines" />
      <AreaChips areas={areas} selected={areaFilter} onChange={setAreaFilter} />

      <main className="lists">
        {error && (
          <p className="form-error" role="alert">
            Couldn't load routines: {error}
          </p>
        )}

        {routines !== null && shown.length === 0 && (
          <div className="empty routines-empty">
            <p>
              {areaFilter
                ? `No routines in ${areasById[areaFilter].name} yet.`
                : 'No routines yet. A routine is a checklist you repeat, like Guest turnover or Monday work setup.'}
            </p>
            <Link to={newLink} className="btn-primary as-link">
              Make a routine
            </Link>
          </div>
        )}

        <ul className="routine-list">
          {shown.map((r) => {
            const area = areasById[r.areaId]
            const showing = open.has(r.id)
            return (
              <li key={r.id} className={`routine-card${showing ? ' is-open' : ''}`}>
                <button
                  type="button"
                  className="routine-toggle"
                  aria-expanded={showing}
                  aria-controls={`routine-${r.id}`}
                  onClick={() => toggle(r.id)}
                >
                  <span className="routine-text">
                    <span className="routine-name">{r.name}</span>
                    <span className="routine-meta">
                      <span className="dot" style={{ background: area.color }} />
                      {routineMeta(r, area.name)}
                      {r.timesUsed > 0 && ` · used ${r.timesUsed} ${r.timesUsed === 1 ? 'time' : 'times'}`}
                    </span>
                    {ruleFor[r.id] && (
                      <span className="routine-repeat">
                        ↻ {repeatSummary(ruleFor[r.id])}
                        {ruleFor[r.id].ifMissed === 'fresh' ? ' · starts fresh' : ''}
                      </span>
                    )}
                  </span>
                  <span aria-hidden="true" className="chevron job-chevron">
                    ›
                  </span>
                </button>

                {showing && (
                  <div id={`routine-${r.id}`} className="routine-body">
                    <ol className="routine-steps">
                      {r.steps.map((step, i) => (
                        <li key={i}>{step}</li>
                      ))}
                    </ol>
                    <span className="field-caps start-caps">START IT ON</span>
                    <div className="routine-actions start-row">
                      <button
                        type="button"
                        className="btn-secondary"
                        disabled={busy === r.id}
                        onClick={() => start(r, { day: todayISO }, 'Today')}
                      >
                        Today
                      </button>
                      <button
                        type="button"
                        className="restore-btn"
                        disabled={busy === r.id}
                        onClick={() => start(r, { day: daysFromToday(1) }, 'tomorrow')}
                      >
                        Tomorrow
                      </button>
                      <button
                        type="button"
                        className="restore-btn"
                        disabled={busy === r.id}
                        onClick={() => start(r, { week: startOfWeekISO(todayISO) }, 'this week')}
                      >
                        This week
                      </button>
                      <button
                        type="button"
                        className="restore-btn"
                        aria-expanded={pickingDay === r.id}
                        onClick={() => setPickingDay(pickingDay === r.id ? null : r.id)}
                      >
                        Other day
                      </button>
                    </div>
                    {pickingDay === r.id && (
                      <label className="field inline-field start-day">
                        <span className="visually-hidden">Day to start {r.name}</span>
                        <input
                          type="date"
                          className="box-input"
                          min={todayISO}
                          onChange={(e) =>
                            e.target.value &&
                            e.target.value >= todayISO &&
                            start(r, { day: e.target.value }, formatShortDate(e.target.value, todayISO))
                          }
                        />
                      </label>
                    )}
                    <div className="routine-actions routine-foot">
                      <Link to={`/routines/${r.id}`} className="text-btn">
                        Edit routine
                      </Link>
                      <span className="hint">
                        Adds one task, “{r.name}”, with these {r.steps.length} steps as its checklist.
                      </span>
                    </div>
                  </div>
                )}
              </li>
            )
          })}
        </ul>

        {taskRules.length > 0 && (
          <section>
            <h2 className="section-title">
              Repeating tasks <span className="count">{taskRules.length}</span>
            </h2>
            <ul className="routine-list">
              {taskRules.map((r) => {
                const area = areasById[r.areaId]
                return (
                  <li key={r.id} className="routine-card">
                    <Link to={`/repeats/${r.id}`} className="routine-toggle">
                      <span className="routine-text">
                        <span className="routine-name">{r.title}</span>
                        <span className="routine-meta">
                          <span className="dot" style={{ background: area.color }} />
                          {area.name} · ↻ {repeatSummary(r)}
                        </span>
                        <span className="routine-repeat">
                          {r.next
                            ? r.next === todayISO
                              ? 'On today'
                              : `Next ${formatShortDate(r.next, todayISO)}`
                            : 'No dates left'}
                          {r.ifMissed === 'fresh' ? ' · starts fresh' : ' · carries over'}
                        </span>
                      </span>
                      <span aria-hidden="true" className="chevron">
                        ›
                      </span>
                    </Link>
                  </li>
                )
              })}
            </ul>
            <p className="hint">To add one, make a task and pick Repeats.</p>
          </section>
        )}
      </main>
    </div>
  )
}
