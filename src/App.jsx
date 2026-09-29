import { useState } from 'react'
import Today from './pages/Today.jsx'
import { sampleAreas, sampleTasks } from './data/sampleTasks.js'
import { toggleDone } from './lib/tasks.js'

// App owns the task list ("lifting state up"): it's the one place that
// changes tasks, and it hands screens a function to ask for a change.
// Step 4 swaps the sample data for Supabase; the shape stays the same.
export default function App() {
  const [tasks, setTasks] = useState(sampleTasks)

  function handleToggle(taskId) {
    // Build a NEW array with a NEW task object for the one that changed.
    // Using the `prev` form means rapid taps never work on stale data.
    setTasks((prev) => prev.map((t) => (t.id === taskId ? toggleDone(t) : t)))
  }

  return <Today areas={sampleAreas} tasks={tasks} onToggle={handleToggle} />
}
