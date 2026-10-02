import { useLayoutEffect, useRef, useState } from 'react'
import { continueList, inlinePieces, renumber, toBlocks, toggleCheck, toggleList } from '../lib/notes.js'

/**
 * Notes with lists. Shows formatted notes when there are some; tap "Edit"
 * (or the notes) to change them. While editing: a small toolbar, and
 * Enter continues a list.
 */
export default function NotesEditor({ id, label = 'NOTES', value, onChange, placeholder }) {
  const [editing, setEditing] = useState(!value)
  const ref = useRef(null)
  const pendingCursor = useRef(null)

  // After we change the text ourselves, put the cursor where it belongs
  useLayoutEffect(() => {
    if (pendingCursor.current !== null && ref.current) {
      ref.current.setSelectionRange(pendingCursor.current, pendingCursor.current)
      pendingCursor.current = null
    }
  })

  function apply(result) {
    if (!result) return false
    pendingCursor.current = result.cursor
    onChange(result.text)
    return true
  }

  function handleKeyDown(e) {
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return
    const el = e.currentTarget
    if (el.selectionStart !== el.selectionEnd) return
    if (apply(continueList(value, el.selectionStart))) e.preventDefault()
  }

  function handleToolbar(kind) {
    const el = ref.current
    const start = el?.selectionStart ?? value.length
    const end = el?.selectionEnd ?? value.length
    apply(toggleList(value, start, end, kind))
    el?.focus()
  }

  if (!editing && value) {
    return (
      <div className="field">
        <div className="notes-head">
          <span className="field-caps">{label}</span>
          <button type="button" className="text-btn" onClick={() => setEditing(true)}>
            Edit
          </button>
        </div>
        <NotesView text={value} onToggle={(line) => onChange(toggleCheck(value, line))} />
      </div>
    )
  }

  return (
    <div className="field">
      <div className="notes-head">
        <label className="field-caps" htmlFor={id}>
          {label}
        </label>
        {value && (
          <button type="button" className="text-btn" onClick={() => setEditing(false)}>
            Done
          </button>
        )}
      </div>
      <div className="notes-toolbar" role="toolbar" aria-label="List formatting">
        {[
          ['bullet', '•', 'Bullets'],
          ['number', '1.', 'Numbers'],
          ['check', '☐', 'Checklist'],
        ].map(([kind, icon, name]) => (
          <button
            key={kind}
            type="button"
            className="tool-btn"
            // Keep the textarea's selection when the button is pressed
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => handleToolbar(kind)}
          >
            <span aria-hidden="true" className="tool-icon">
              {icon}
            </span>
            {name}
          </button>
        ))}
      </div>
      <textarea
        id={id}
        ref={ref}
        className="notes-input"
        value={value}
        onChange={(e) => onChange(renumberKeepingCursor(e.currentTarget, pendingCursor))}
        onKeyDown={handleKeyDown}
        rows={4}
        placeholder={placeholder}
      />
      <span className="hint">Tip: start a line with "- ", "1. " or "- [ ] ". **Double stars** make bold.</span>
    </div>
  )
}

// Typing or deleting inside a numbered list keeps the numbers in order
function renumberKeepingCursor(el, pendingCursor) {
  const text = el.value
  const fixed = renumber(text)
  if (fixed !== text) pendingCursor.current = renumber(text.slice(0, el.selectionStart)).length
  return fixed
}

/** Formatted notes. Checklist boxes can be ticked right here. */
export function NotesView({ text, onToggle }) {
  return (
    <div className="notes-view">
      {toBlocks(text).map((block, i) => {
        if (block.type === 'gap') return <div key={i} className="notes-gap" />
        if (block.type === 'text') {
          return (
            <p key={i}>
              {block.lines.map((l, j) => (
                <span key={l.line}>
                  {j > 0 && <br />}
                  <Inline text={l.text} />
                </span>
              ))}
            </p>
          )
        }
        if (block.type === 'number') {
          return (
            <ol key={i} start={block.start}>
              {block.items.map((it) => (
                <li key={it.line}>
                  <Inline text={it.text} />
                </li>
              ))}
            </ol>
          )
        }
        if (block.type === 'check') {
          return (
            <ul key={i} className="checklist">
              {block.items.map((it) => (
                <li key={it.line} className={it.checked ? 'is-checked' : ''}>
                  <label>
                    <input
                      type="checkbox"
                      checked={Boolean(it.checked)}
                      disabled={!onToggle}
                      onChange={() => onToggle?.(it.line)}
                    />
                    <span>
                      <Inline text={it.text} />
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )
        }
        return (
          <ul key={i}>
            {block.items.map((it) => (
              <li key={it.line}>
                <Inline text={it.text} />
              </li>
            ))}
          </ul>
        )
      })}
    </div>
  )
}

function Inline({ text }) {
  return inlinePieces(text).map((p, i) => {
    if (p.type === 'bold') return <strong key={i}>{p.value}</strong>
    if (p.type === 'link')
      return (
        <a key={i} href={p.value} target="_blank" rel="noreferrer noopener">
          {p.value.replace(/^https?:\/\//, '')}
        </a>
      )
    return <span key={i}>{p.value}</span>
  })
}
