import Today from './pages/Today.jsx'
import { sampleAreas, sampleTasks } from './data/sampleTasks.js'

// For now the app is one screen fed by sample data.
// Step 4 swaps the sample data for Supabase; later steps add routes.
export default function App() {
  return <Today areas={sampleAreas} tasks={sampleTasks} />
}
