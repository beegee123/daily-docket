import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import {
  acceptMyInvites,
  fetchAreas,
  fetchPeople,
  fetchOpenClosure,
  fetchTodayTasks,
  saveDoneState,
  seedStarterAreas,
  syncTimezone,
} from '../lib/api.js'
import { startOfLocalDayISO, toLocalISODate } from '../lib/dates.js'
import { toggleDone } from '../lib/tasks.js'

/**
 * Loads the signed-in person's areas and today's tasks, keeps them in
 * sync with the database, and saves ticks.
 */
export function useDocket(userId) {
  const [areas, setAreas] = useState([])
  const [tasks, setTasks] = useState([])
  const [people, setPeople] = useState({}) // { userId: email } of people I share with
  const [closure, setClosure] = useState(null) // today's close, if not reopened
  const [status, setStatus] = useState('loading') // 'loading' | 'ready' | 'error'
  const [error, setError] = useState(null)
  // A short message at the bottom of the screen, optionally with a button:
  // { message, action: { label, run } | null }
  const [notice, setNotice] = useState(null)
  const announce = useCallback((message, action = null) => setNotice({ message, action }), [])

  // Fetch areas and tasks. `quiet` refreshes without the loading screen.
  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setStatus('loading')
    try {
      const now = new Date()
      const [nextAreas, nextTasks, nextClosure, nextPeople] = await Promise.all([
        fetchAreas(),
        fetchTodayTasks(toLocalISODate(now), startOfLocalDayISO(now)),
        fetchOpenClosure(toLocalISODate(now)),
        fetchPeople().catch(() => ({})), // tags are a nicety
      ])
      // Your own areas first (in your order), then areas shared with you
      nextAreas.sort((a, b) => (a.ownerId === userId) === (b.ownerId === userId) ? 0 : a.ownerId === userId ? -1 : 1)
      setAreas(nextAreas)
      setPeople(nextPeople)
      setTasks(nextTasks)
      setClosure(nextClosure)
      setStatus('ready')
      setError(null)
    } catch (e) {
      if (!quiet) {
        setError(e.message)
        setStatus('error')
      }
    }
  }, [userId])

  // First load: make sure starter areas exist, then fetch
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        await seedStarterAreas()
        // Someone may have shared an area with my email since last time
        await acceptMyInvites().catch((e) => console.warn('Invites not checked', e.message))
        // Digest times are in your own timezone; keep it current (travel!).
        // Not worth stopping the app over if it fails.
        syncTimezone(userId).catch((e) => console.warn('Timezone not saved', e.message))
      } catch (e) {
        if (!cancelled) {
          setError(e.message)
          setStatus('error')
        }
        return
      }
      if (!cancelled) load()
    })()
    return () => {
      cancelled = true
    }
  }, [userId, load])

  // Live sync. Any change to your tasks (from this device or another)
  // triggers a quiet reload. Several changes close together are grouped
  // into one reload.
  const reloadTimer = useRef(null)
  useEffect(() => {
    const scheduleReload = () => {
      clearTimeout(reloadTimer.current)
      reloadTimer.current = setTimeout(() => load({ quiet: true }), 300)
    }

    const channel = supabase
      .channel(`docket-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'docket', table: 'tasks' }, scheduleReload)
      .on('postgres_changes', { event: '*', schema: 'docket', table: 'task_areas' }, scheduleReload)
      .on('postgres_changes', { event: '*', schema: 'docket', table: 'day_closures' }, scheduleReload)
      .on('postgres_changes', { event: '*', schema: 'docket', table: 'areas' }, scheduleReload)
      .on('postgres_changes', { event: '*', schema: 'docket', table: 'area_members' }, scheduleReload)
      .subscribe()

    // Coming back to the app (or past midnight) also refreshes
    const onVisible = () => {
      if (document.visibilityState === 'visible') scheduleReload()
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      clearTimeout(reloadTimer.current)
      document.removeEventListener('visibilitychange', onVisible)
      supabase.removeChannel(channel)
    }
  }, [userId, load])

  // Optimistic tick: update the screen straight away, then save.
  // If the save fails, put the task back and say so.
  async function toggle(taskId) {
    const before = tasks.find((t) => t.id === taskId)
    if (!before) return
    const after = toggleDone(before)

    setTasks((prev) => prev.map((t) => (t.id === taskId ? after : t)))
    try {
      await saveDoneState(after, userId)
    } catch {
      setTasks((prev) => prev.map((t) => (t.id === taskId ? before : t)))
      announce("Couldn't save that. Check your connection and try again.")
    }
  }

  // Hide the notice after a few seconds (longer if it has an Undo button)
  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(null), notice.action ? 10000 : 4000)
    return () => clearTimeout(timer)
  }, [notice])

  return {
    areas,
    tasks,
    people,
    closure,
    status,
    error,
    notice,
    toggle,
    retry: () => load(),
    refresh: () => load({ quiet: true }),
    announce,
    dismissNotice: () => setNotice(null),
  }
}
