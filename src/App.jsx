import { BrowserRouter, Navigate, Route, Routes } from 'react-router'
import StatusScreen from './components/StatusScreen.jsx'
import Today from './pages/Today.jsx'
import TaskForm from './pages/TaskForm.jsx'
import CloseDay from './pages/CloseDay.jsx'
import History from './pages/History.jsx'
import SignIn from './pages/SignIn.jsx'
import { useDocket } from './hooks/useDocket.js'
import { useSession } from './hooks/useSession.js'
import { closeDay } from './lib/api.js'
import { configError, supabase } from './lib/supabase.js'

// Which screen to show: setup message, loading, sign-in, or your docket.
export default function App() {
  const session = useSession()

  if (configError) return <StatusScreen title="Setup needed" message={configError} />
  if (session === undefined) return <StatusScreen title="Loading…" />
  if (!session) return <SignIn />

  // key: if someone else signs in on this device, start completely fresh
  return (
    <BrowserRouter>
      <Docket key={session.user.id} user={session.user} />
    </BrowserRouter>
  )
}

function Docket({ user }) {
  const { areas, tasks, status, error, notice, toggle, retry, refresh, announce, dismissNotice } =
    useDocket(user.id)

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

  // After Close the day: refresh, and offer Undo for a few seconds
  function handleClosed(message, undoItems) {
    refresh()
    const undo = {
      label: 'Undo',
      run: async () => {
        try {
          await closeDay(undoItems)
          refresh()
          announce('Close undone')
        } catch (e) {
          announce(`Couldn't undo: ${e.message}`)
        }
      },
    }
    announce(message, undoItems.length ? undo : null)
  }

  // One address per screen, so the phone's back button works
  return (
    <>
      <Routes>
        <Route
          path="/"
          element={
            <Today
              areas={areas}
              tasks={tasks}
              onToggle={toggle}
              userEmail={user.email}
              onSignOut={() => supabase.auth.signOut()}
            />
          }
        />
        <Route path="/task/new" element={<TaskForm areas={areas} onSaved={refresh} />} />
        <Route path="/task/:id" element={<TaskForm areas={areas} onSaved={refresh} />} />
        <Route path="/close" element={<CloseDay areas={areas} tasks={tasks} onClosed={handleClosed} />} />
        <Route
          path="/history"
          element={<History areas={areas} userId={user.id} onChanged={refresh} announce={announce} />}
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      {notice && (
        <div className="toast" role="status">
          <span>{notice.message}</span>
          {notice.action && (
            <button
              type="button"
              className="toast-action"
              onClick={() => {
                const { run } = notice.action
                dismissNotice()
                run()
              }}
            >
              {notice.action.label}
            </button>
          )}
        </div>
      )}
    </>
  )
}
