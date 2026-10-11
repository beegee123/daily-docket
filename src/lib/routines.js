// Routines (step 22): pure helpers for editing a routine's steps.
// Steps are a plain list of strings, in order.

import { parsePastedList } from './week.js'

export const MAX_STEPS = 50

/** Trimmed, with blank steps left out: what actually gets saved. */
export const cleanSteps = (steps) => steps.map((s) => s.trim()).filter(Boolean)

/** Move one step up (-1) or down (+1). Out of range: unchanged. */
export function moveStep(steps, index, direction) {
  const to = index + direction
  if (index < 0 || index >= steps.length || to < 0 || to >= steps.length) return steps
  const next = [...steps]
  ;[next[index], next[to]] = [next[to], next[index]]
  return next
}

/** A new blank step right after `index` (or at the end). */
export function insertStepAfter(steps, index) {
  const next = [...steps]
  next.splice(index + 1, 0, '')
  return next
}

export const removeStep = (steps, index) => steps.filter((_, i) => i !== index)

/**
 * Pasted text -> steps. Same cleaning as Paste a list on tasks (bullets,
 * numbers and checkboxes removed); indented lines count as steps too,
 * since a routine has only one level.
 */
export function pastedSteps(text) {
  return parsePastedList(text.replace(/^[ \t]+/gm, '')).map((t) => t.title)
}

/** "Rentals · 6 steps" */
export function routineMeta(routine, areaName) {
  const n = routine.steps.length
  return [areaName, `${n} ${n === 1 ? 'step' : 'steps'}`].filter(Boolean).join(' · ')
}
