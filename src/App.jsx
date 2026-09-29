import StatusScreen from './components/StatusScreen.jsx'
import Today from './pages/Today.jsx'
import SignIn from './pages/SignIn.jsx'
import { useDocket } from './hooks/useDocket.js'
import { useSession } from './hooks/useSession.js'
import { configError, supabase } from './lib/supabase.js'

// Which screen to show: setup message, loading, sign-in, or your docket.
export default function App() {
  const session = useSession()

  if (configError) return <StatusScreen title="Setup needed" message={configError} />
  if (session === undefined) return <StatusScreen title="Loading…" />
  if (!session) return <SignIn />

  // key: if someone else signs in on this device, start completely fresh
  return <Docket key={session.user.id} user={session.user} />
}

function Docket({ user }) {
  const { areas, tasks, status, error, notice, toggle, retry } = useDocket(user.id)

  if (status === 'loading') return <StatusScreen title="Loading your docket…" />

  if (status === 'error') {
    return (
      <StatusScreen
        title="Couldn't load your docket"
        message={error}
        action={
          <button type="button" className="btn-primary" onClick={retry}>
            Try again
          </button>
        }
      />
    )
  }

  return (
    <>
      <Today
        areas={areas}
        tasks={tasks}
        onToggle={toggle}
        userEmail={user.email}
        onSignOut={() => supabase.auth.signOut()}
      />
      {notice && (
        <div className="toast" role="alert">
          {notice}
        </div>
      )}
    </>
  )
}
