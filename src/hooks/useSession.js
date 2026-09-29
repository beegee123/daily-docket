import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'

/**
 * The signed-in session.
 *   undefined = still checking (show a loading screen)
 *   null      = signed out
 *   object    = signed in; session.user has the id and email
 * Supabase keeps the session in the browser, so you stay signed in
 * between visits.
 */
export function useSession() {
  const [session, setSession] = useState(undefined)

  useEffect(() => {
    if (!supabase) return

    supabase.auth.getSession().then(({ data }) => setSession(data.session))

    // Fires on sign-in, sign-out and token refresh
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next))
    return () => data.subscription.unsubscribe()
  }, [])

  return session
}
