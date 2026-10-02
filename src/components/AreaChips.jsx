/**
 * The row of area filter chips. `selected` is an area id, or null for All.
 * Tapping the selected chip again goes back to All.
 */
export default function AreaChips({ areas, selected, onChange, mine = null }) {
  return (
    <div className="chips" role="group" aria-label="Filter by area">
      <button
        type="button"
        className={`chip${selected === null ? ' is-on' : ''}`}
        aria-pressed={selected === null}
        onClick={() => onChange(null)}
      >
        All
      </button>
      {mine && (
        <button
          type="button"
          className={`chip chip-mine${mine.on ? ' is-on' : ''}`}
          aria-pressed={mine.on}
          onClick={mine.onToggle}
        >
          Mine
        </button>
      )}
      {areas.map((area) => {
        const on = selected === area.id
        return (
          <button
            type="button"
            key={area.id}
            className={`chip${on ? ' is-on' : ''}`}
            aria-pressed={on}
            onClick={() => onChange(on ? null : area.id)}
          >
            <span className="dot" style={{ background: on ? '#FFFFFF' : area.color }} />
            {area.name}
          </button>
        )
      })}
    </div>
  )
}
