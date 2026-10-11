import { describe, expect, it } from 'vitest'
import { cleanSteps, insertStepAfter, moveStep, pastedSteps, removeStep, routineMeta } from './routines.js'

const steps = ['Strip beds', 'Clean kitchen', 'Restock']

describe('editing steps', () => {
  it('moves a step up and down, and ignores moves off the ends', () => {
    expect(moveStep(steps, 1, -1)).toEqual(['Clean kitchen', 'Strip beds', 'Restock'])
    expect(moveStep(steps, 1, 1)).toEqual(['Strip beds', 'Restock', 'Clean kitchen'])
    expect(moveStep(steps, 0, -1)).toBe(steps)
    expect(moveStep(steps, 2, 1)).toBe(steps)
  })
  it('inserts a blank step after one, and removes one', () => {
    expect(insertStepAfter(steps, 0)).toEqual(['Strip beds', '', 'Clean kitchen', 'Restock'])
    expect(insertStepAfter([], -1)).toEqual([''])
    expect(removeStep(steps, 1)).toEqual(['Strip beds', 'Restock'])
  })
  it('saves trimmed steps without blanks', () => {
    expect(cleanSteps(['  Strip beds ', '', '   ', 'Restock'])).toEqual(['Strip beds', 'Restock'])
  })
})

describe('pasting', () => {
  it('turns a pasted checklist into steps, flattening indents', () => {
    const text = 'Guest turnover:\n- [ ] Strip beds\n  - Clean kitchen\n☐ Restock\n\n3. Photo walkthrough'
    expect(pastedSteps(text)).toEqual(['Guest turnover:', 'Strip beds', 'Clean kitchen', 'Restock', 'Photo walkthrough'])
  })
})

describe('card text', () => {
  it('names the area and counts steps', () => {
    expect(routineMeta({ steps }, 'Rentals')).toBe('Rentals · 3 steps')
    expect(routineMeta({ steps: ['One'] }, 'Home')).toBe('Home · 1 step')
  })
})
