import { createClient } from '@supabase/supabase-js'

// Values come from .env.local (never committed). Vite only exposes
// variables that start with VITE_ to the browser.
const url = import.meta.env.VITE_SUPABASE_URL
// Same variable name as Pantry. Supabase calls this the publishable key
// (older projects call it the anon key); it's safe to use in the browser.
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

const missing = !url || !key || url.includes('your-project-ref') || key.startsWith('your-')

/** A message for the screen if .env.local isn't filled in yet, otherwise null. */
export const configError = missing
  ? 'Add your Supabase URL and key to .env.local (copy them from Pantry), then restart npm run dev.'
  : null

// One shared client for the whole app. Every table call goes to the
// "docket" schema unless we say otherwise. Sign-in is shared with Pantry
// because it's the same Supabase project.
export const supabase = missing
  ? null
  : createClient(url, key, { db: { schema: 'docket' } })
