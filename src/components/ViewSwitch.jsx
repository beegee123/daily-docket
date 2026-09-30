import { Link } from 'react-router'

/** Today / Week / Routines. Routines arrives in Phase 3. */
export default function ViewSwitch({ current }) {
  return (
    <nav className="view-switch" aria-label="Views">
      <Link to="/" className={current === 'today' ? 'is-on' : ''} aria-current={current === 'today' ? 'page' : undefined}>
        Today
      </Link>
      <Link to="/week" className={current === 'week' ? 'is-on' : ''} aria-current={current === 'week' ? 'page' : undefined}>
        Week
      </Link>
      <span className="is-soon" aria-disabled="true" title="Coming in Phase 3">
        Routines
      </span>
    </nav>
  )
}
