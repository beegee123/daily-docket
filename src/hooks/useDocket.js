import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { fetchAreas, fetchTodayTasks, saveDoneState, seedStarterAreas } from '../lib/api.js'
import { startOfLocalDayISO, toLocalISODate } from '../lib/dates.js'
import { toggleDone } from '../lib/tasks.js'

/**
 * Loads the signed-in person's areas and today's tasks, keeps them in
 * sync with the database, and saves ticks.
 */
export function useDocket(userId) {
  const [areas, setAreas] = useState([])
  const [tasks, setTasks] = useState([])
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
      const [nextAreas, nextTasks] = await Promise.all([
        fetchAreas(),
        fetchTodayTasks(toLocalISODate(now), startOfLocalDayISO(now)),
      ])
      setAreas(nextAreas)
      setTasks(nextTasks)
      setStatus('ready')
      setError(null)
    } catch (e) {
      if (!quiet) {
        setError(e.message)
        setStatus('error')
      }
    }
  }, [])

  // First load: make sure starter areas exist, then fetch
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        await seedStarterAreas()
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
