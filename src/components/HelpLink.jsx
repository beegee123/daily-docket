import { Link } from 'react-router'

/** A small "?" in a screen's header that opens that topic in the guide. */
export default function HelpLink({ topic, label }) {
  return (
    <Link to={`/help#${topic}`} className="help-link" aria-label={label}>
      ?
    </Link>
  )
}
