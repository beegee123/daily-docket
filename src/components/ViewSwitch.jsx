import { Link } from 'react-router'

/** Today / Week / Routines. */
export default function ViewSwitch({ current }) {
  return (
    <nav className="view-switch" aria-label="Views">
      <Link to="/" className={current === 'today' ? 'is-on' : ''} aria-current={current === 'today' ? 'page' : undefined}>
        Today
      </Link>
      <Link to="/week" className={current === 'week' ? 'is-on' : ''} aria-current={current === 'week' ? 'page' : undefined}>
        Week
      </Link>
      <Link
        to="/routines"
        className={current === 'routines' ? 'is-on' : ''}
        aria-current={current === 'routines' ? 'page' : undefined}
      >
        Routines
      </Link>
    </nav>
  )
}
