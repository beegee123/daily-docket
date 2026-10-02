// Notes are plain text with a few list conventions, so they read fine
// anywhere (Telegram, the digest) and look nice in the app:
//   - bullet          1. numbered          - [ ] to do   - [x] done
//   **bold**          https://links
// Everything here is a "pure" function: text in, text out.

const CHECK = /^(\s*)- \[( |x|X)\] (.*)$/
const BULLET = /^(\s*)[-*] (.*)$/
const NUMBER = /^(\s*)(\d+)\. (.*)$/

/** What kind of line is this? */
export function parseLine(line) {
  let m = line.match(CHECK)
  if (m) return { kind: 'check', indent: m[1], checked: m[2].toLowerCase() === 'x', rest: m[3] }
  m = line.match(BULLET)
  if (m) return { kind: 'bullet', indent: m[1], rest: m[2] }
  m = line.match(NUMBER)
  if (m) return { kind: 'number', indent: m[1], num: Number(m[2]), rest: m[3] }
  return { kind: 'text', indent: '', rest: line }
}

function prefixFor(kind, indent = '', num = 1) {
  if (kind === 'bullet') return `${indent}- `
  if (kind === 'number') return `${indent}${num}. `
  if (kind === 'check') return `${indent}- [ ] `
  return indent
}

/** Make each run of numbered lines count 1, 2, 3… */
export function renumber(text) {
  let next = 1
  let inRun = false
  return text
    .split('\n')
    .map((line) => {
      const p = parseLine(line)
      if (p.kind !== 'number') {
        inRun = false
        return line
      }
      if (!inRun) next = 1
      inRun = true
      return `${p.indent}${next++}. ${p.rest}`
    })
    .join('\n')
}

/**
 * Enter pressed at `cursor`. Inside a list, start the next item (or end the
 * list if the current item is empty). Returns { text, cursor } or null to
 * let the textarea handle Enter normally.
 */
export function continueList(text, cursor) {
  const lineStart = text.lastIndexOf('\n', cursor - 1) + 1
  const lineEndIdx = text.indexOf('\n', cursor)
  const lineEnd = lineEndIdx === -1 ? text.length : lineEndIdx
  const line = text.slice(lineStart, lineEnd)
  const p = parseLine(line)
  if (p.kind === 'text') return null

  // Empty item: Enter ends the list (removes the marker)
  if (p.rest.trim() === '' && cursor >= lineEnd) {
    const out = text.slice(0, lineStart) + text.slice(lineEnd)
    return { text: renumber(out), cursor: lineStart }
  }

  const prefix = prefixFor(p.kind, p.indent, (p.num ?? 0) + 1)
  const out = text.slice(0, cursor) + '\n' + prefix + text.slice(cursor)
  const newCursor = cursor + 1 + prefix.length
  const renumbered = renumber(out)
  // Numbers before the cursor only depend on earlier lines, so the
  // renumbered prefix tells us where the cursor ends up
  return { text: renumbered, cursor: renumber(out.slice(0, newCursor)).length }
}

/**
 * Toolbar button: turn the selected lines into a list of `kind`, or back
 * into plain lines if they already all are that kind.
 */
export function toggleList(text, selStart, selEnd, kind) {
  const start = text.lastIndexOf('\n', selStart - 1) + 1
  const endIdx = text.indexOf('\n', Math.max(selEnd - (selEnd > selStart ? 1 : 0), selStart))
  const end = endIdx === -1 ? text.length : endIdx
  const lines = text.slice(start, end).split('\n')
  const parsed = lines.map(parseLine)
  const allSame = parsed.every((p) => p.kind === kind || (p.rest === '' && lines.length > 1))

  const changed = parsed.map((p, i) =>
    allSame ? p.indent + p.rest : prefixFor(kind, p.indent, i + 1) + p.rest,
  )
  const block = changed.join('\n')
  const out = renumber(text.slice(0, start) + block + text.slice(end))
  const cursor = renumber(text.slice(0, start) + block).length
  return { text: out, cursor }
}

/** Tick or untick the checklist item on line `index`. */
export function toggleCheck(text, index) {
  const lines = text.split('\n')
  const p = parseLine(lines[index] ?? '')
  if (p.kind !== 'check') return text
  lines[index] = `${p.indent}- [${p.checked ? ' ' : 'x'}] ${p.rest}`
  return lines.join('\n')
}

/**
 * Group lines into blocks for display:
 *   { type: 'bullet'|'number'|'check', items: [{ text, line, checked, num }] }
 *   { type: 'text', lines: [{ text, line }] }
 */
export function toBlocks(text) {
  const blocks = []
  text.split('\n').forEach((raw, line) => {
    const p = parseLine(raw)
    const type = p.kind
    const last = blocks[blocks.length - 1]
    if (type === 'text') {
      if (raw.trim() === '') {
        blocks.push({ type: 'gap' })
        return
      }
      if (last?.type === 'text') last.lines.push({ text: p.rest, line })
      else blocks.push({ type: 'text', lines: [{ text: p.rest, line }] })
      return
    }
    const item = { text: p.rest, line, checked: p.checked, num: p.num }
    if (last?.type === type) last.items.push(item)
    else blocks.push({ type, start: p.num ?? 1, items: [item] })
  })
  // Collapse repeated gaps and drop gaps at the ends
  return blocks.filter((b, i, all) => b.type !== 'gap' || (i > 0 && i < all.length - 1 && all[i - 1].type !== 'gap'))
}

/** Split a line into plain, **bold** and link pieces. */
export function inlinePieces(text) {
  const parts = []
  const re = /(\*\*[^*]+\*\*|https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/g
  let last = 0
  let m
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push({ type: 'text', value: text.slice(last, m.index) })
    if (m[0].startsWith('**')) parts.push({ type: 'bold', value: m[0].slice(2, -2) })
    else parts.push({ type: 'link', value: m[0] })
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push({ type: 'text', value: text.slice(last) })
  return parts
}
