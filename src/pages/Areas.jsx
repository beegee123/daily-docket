import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { createArea, deleteArea, fetchAreaCounts, reorderAreas, updateArea } from '../lib/api.js'

// Eight colours that read well as small dots on white and stay distinct
export const AREA_COLORS = [
  { hex: '#2B45C9', name: 'Cobalt' },
  { hex: '#0F7A6E', name: 'Green' },
  { hex: '#8A3FA0', name: 'Purple' },
  { hex: '#B86E00', name: 'Amber' },
  { hex: '#0E7490', name: 'Teal' },
  { hex: '#9D174D', name: 'Berry' },
  { hex: '#4D7C0F', name: 'Olive' },
  { hex: '#475467', name: 'Slate' },
]

/**
 * Manage areas. One row opens at a time for editing (editingId), or the
 * "new area" form at the bottom (editingId === 'new').
 */
export default function Areas({ areas, onChanged, announce }) {
  const [counts, setCounts] = useState({})
  const [editingId, setEditingId] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const loadCounts = useCallback(() => {
    fetchAreaCounts()
      .then(setCounts)
      .catch(() => {}) // counts are a nicety; the screen works without them
  }, [])

  useEffect(() => {
    loadCounts()
  }, [loadCounts, areas])

  // Run a change, then refresh everything. Errors show above the list.
  async function run(action, message) {
    setBusy(true)
    setError(null)
    try {
      await action()
      await onChanged()
      loadCounts()
      setEditingId(null)
      if (message) announce(message)
    } catch (e) {
      setError(e.message)
    }
    setBusy(false)
  }

  function move(index, by) {
    const ids = areas.map((a) => a.id)
    const [moved] = ids.splice(index, 1)
    ids.splice(index + by, 0, moved)
    run(() => reorderAreas(ids))
  }

  const nextSortOrder = Math.max(0, ...areas.map((a) => a.sortOrder ?? 0)) + 1

  return (
    <div className="screen areas-screen">
      <header className="close-header">
        <Link to="/settings" className="text-btn back-link">Back to settings</Link>
        <span className="eyebrow">SETTINGS</span>
        <h1>Areas</h1>
        <p className="lead">The order here is the order of the chips on Today and Week.</p>
      </header>

      <main className="lists">
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}

        <ul className="area-list">
          {areas.map((area, i) => {
            const c = counts[area.id] ?? { open: 0, total: 0 }
            if (editingId === area.id) {
              return (
                <li key={area.id}>
                  <AreaEditor
                    area={area}
                    total={c.total}
                    otherAreas={areas.filter((a) => a.id !== area.id)}
                    busy={busy}
                    onCancel={() => setEditingId(null)}
                    onSave={(fields) => run(() => updateArea(area.id, fields), 'Area saved')}
                    onDelete={(moveTo) =>
                      run(async () => {
                        const moved = await deleteArea(area.id, moveTo)
                        const target = areas.find((a) => a.id === moveTo)
                        announce(
                          moved && target
                            ? `${area.name} deleted · ${moved} ${moved === 1 ? 'task' : 'tasks'} moved to ${target.name}`
                            : `${area.name} deleted`,
                        )
                      })
                    }
                  />
                </li>
              )
            }
            return (
              <li key={area.id} className="area-row">
                <span className="area-swatch" style={{ background: area.color }} aria-hidden="true" />
                <span className="area-text">
                  <span className="settings-name">{area.name}</span>
                  <span className="settings-sub">{c.open} open</span>
                </span>
                <span className="area-actions">
                  <button
                    type="button"
                    className="icon-btn small"
                    aria-label={`Move ${area.name} up`}
                    disabled={busy || i === 0}
                    onClick={() => move(i, -1)}
                  >
                    <Arrow dir="up" />
                  </button>
                  <button
                    type="button"
                    className="icon-btn small"
                    aria-label={`Move ${area.name} down`}
                    disabled={busy || i === areas.length - 1}
                    onClick={() => move(i, 1)}
                  >
                    <Arrow dir="down" />
                  </button>
                  <button
                    type="button"
                    className="restore-btn"
                    disabled={busy}
                    onClick={() => {
                      setError(null)
                      setEditingId(area.id)
                    }}
                  >
                    Edit
                  </button>
                </span>
              </li>
            )
          })}
        </ul>

        {editingId === 'new' ? (
          <AreaEditor
            area={{ name: '', color: AREA_COLORS.find((c) => !areas.some((a) => a.color === c.hex))?.hex ?? AREA_COLORS[0].hex }}
            isNew
            busy={busy}
            onCancel={() => setEditingId(null)}
            onSave={(fields) => run(() => createArea({ ...fields, sortOrder: nextSortOrder }), `${fields.name.trim()} added`)}
          />
        ) : (
          <button
            type="button"
            className="btn-secondary"
            disabled={busy}
            onClick={() => {
              setError(null)
              setEditingId('new')
            }}
          >
            Add an area
          </button>
        )}
      </main>
    </div>
  )
}

/** Name, colour, and (for existing areas) delete with "move tasks to". */
function AreaEditor({ area, isNew = false, total = 0, otherAreas = [], busy, onCancel, onSave, onDelete }) {
  const [name, setName] = useState(area.name)
  const [color, setColor] = useState(area.color)
  const [deleting, setDeleting] = useState(false)
  const [moveTo, setMoveTo] = useState(otherAreas[0]?.id ?? '')
  const [problem, setProblem] = useState(null)

  // Keep a custom colour (set before this screen existed) as an option
  const colors = AREA_COLORS.some((c) => c.hex.toLowerCase() === area.color?.toLowerCase())
    ? AREA_COLORS
    : [{ hex: area.color, name: 'Current' }, ...AREA_COLORS]

  function save(e) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return setProblem('Give the area a name.')
    if (trimmed.length > 40) return setProblem('Keep the name to 40 characters or fewer.')
    setProblem(null)
    onSave({ name: trimmed, color })
  }

  return (
    <form className="area-editor" onSubmit={save}>
      <label className="field">
        <span className="field-caps">{isNew ? 'NEW AREA' : 'NAME'}</span>
        <input
          className="box-input"
          value={name}
          maxLength={40}
          autoFocus
          placeholder="e.g. PD1, Garden, Choir"
          onChange={(e) => setName(e.target.value)}
        />
      </label>

      <fieldset className="field">
        <legend className="field-caps">COLOUR</legend>
        <div className="swatch-row">
          {colors.map((c) => (
            <label key={c.hex} className="swatch-option" title={c.name}>
              <input
                type="radio"
                name={`color-${area.id ?? 'new'}`}
                value={c.hex}
                checked={color.toLowerCase() === c.hex.toLowerCase()}
                onChange={() => setColor(c.hex)}
                className="visually-hidden"
              />
              <span className="swatch-dot" style={{ background: c.hex }} />
              <span className="visually-hidden">{c.name}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {problem && (
        <p className="form-error" role="alert">
          {problem}
        </p>
      )}

      {!deleting && (
        <div className="editor-actions">
          <button type="submit" className="btn-dark" disabled={busy}>
            {busy ? 'Saving…' : isNew ? 'Add area' : 'Save'}
          </button>
          <button type="button" className="text-btn" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          {!isNew && otherAreas.length > 0 && (
            <button type="button" className="danger-btn push-right" onClick={() => setDeleting(true)} disabled={busy}>
              Delete
            </button>
          )}
        </div>
      )}

      {deleting && (
        <div className="delete-box" role="group" aria-label={`Delete ${area.name}`}>
          {total > 0 ? (
            <>
              <label className="field">
                <span className="settings-name">
                  Move its {total} {total === 1 ? 'task' : 'tasks'} to
                </span>
                <select className="box-input" value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>
                  {otherAreas.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>
              <span className="settings-sub">Includes done and dropped tasks, so History stays complete.</span>
            </>
          ) : (
            <span className="settings-sub">This area has no tasks.</span>
          )}
          <div className="editor-actions">
            <button type="button" className="btn-danger" disabled={busy} onClick={() => onDelete(total > 0 ? moveTo : null)}>
              {total > 0 ? 'Move tasks and delete' : `Delete ${area.name}`}
            </button>
            <button type="button" className="text-btn" onClick={() => setDeleting(false)} disabled={busy}>
              Keep it
            </button>
          </div>
        </div>
      )}
    </form>
  )
}

function Arrow({ dir }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={dir === 'up' ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6'} />
    </svg>
  )
}
