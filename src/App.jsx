import { BrowserRouter, Navigate, Route, Routes } from 'react-router'
import StatusScreen from './components/StatusScreen.jsx'
import Today from './pages/Today.jsx'
import TaskForm from './pages/TaskForm.jsx'
import CloseDay from './pages/CloseDay.jsx'
import History from './pages/History.jsx'
import Settings from './pages/Settings.jsx'
import Week from './pages/Week.jsx'
import Day from './pages/Day.jsx'
import ShiftPlan from './pages/ShiftPlan.jsx'
import SignIn from './pages/SignIn.jsx'
import { useDocket } from './hooks/useDocket.js'
import { useSession } from './hooks/useSession.js'
import { reopenDay } from './lib/api.js'
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
  const { areas, tasks, closure, status, error, notice, toggle, retry, refresh, announce, dismissNotice } =
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

  // Put a closed day back exactly as it was
  async function handleReopen(closureId) {
    try {
      await reopenDay(closureId)
      refresh()
      announce('Day reopened')
    } catch (e) {
      announce(`Couldn't reopen: ${e.message}`)
    }
  }

  // After Close the day: refresh, and offer Undo for a few seconds.
  // (Reopen on Today does the same thing until midnight.)
  function handleClosed(message, closureId) {
    refresh()
    announce(message, { label: 'Undo', run: () => handleReopen(closureId) })
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
              closure={closure}
              onReopen={handleReopen}
              userEmail={user.email}
              onSignOut={() => supabase.auth.signOut()}
            />
          }
        />
        <Route path="/task/new" element={<TaskForm areas={areas} onSaved={refresh} announce={announce} />} />
        <Route path="/task/:id" element={<TaskForm areas={areas} onSaved={refresh} announce={announce} />} />
        <Route path="/close" element={<CloseDay areas={areas} tasks={tasks} onClosed={handleClosed} />} />
        <Route
          path="/history"
          element={<History areas={areas} userId={user.id} onChanged={refresh} announce={announce} />}
        />
        <Route path="/week" element={<Week areas={areas} changeSignal={tasks} />} />
        <Route path="/shift/:areaId" element={<ShiftPlan areas={areas} onChanged={refresh} announce={announce} />} />
        <Route
          path="/day/:date"
          element={<Day areas={areas} userId={user.id} changeSignal={tasks} onChanged={refresh} announce={announce} />}
        />
        <Route
          path="/settings"
          element={
            <Settings
              userId={user.id}
              userEmail={user.email}
              onSignOut={() => supabase.auth.signOut()}
              announce={announce}
            />
          }
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
