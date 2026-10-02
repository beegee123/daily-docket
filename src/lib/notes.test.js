import { describe, expect, it } from 'vitest'
import { continueList, inlinePieces, renumber, toBlocks, toggleCheck, toggleList } from './notes.js'

describe('Enter in a list', () => {
  it('continues a numbered list', () => {
    expect(continueList('1. Call bank', 12)).toEqual({ text: '1. Call bank\n2. ', cursor: 16 })
  })
  it('continues bullets', () => {
    expect(continueList('- milk', 6)).toEqual({ text: '- milk\n- ', cursor: 9 })
  })
  it('starts the next checklist item unticked', () => {
    expect(continueList('- [x] invoice', 13)).toEqual({ text: '- [x] invoice\n- [ ] ', cursor: 20 })
  })
  it('ends the list on an empty item', () => {
    expect(continueList('1. a\n2. ', 8)).toEqual({ text: '1. a\n', cursor: 5 })
  })
  it('leaves plain text alone', () => {
    expect(continueList('hello', 5)).toBeNull()
  })
  it('renumbers when inserting in the middle', () => {
    expect(continueList('1. a\n2. b\n3. c', 4)).toEqual({ text: '1. a\n2. \n3. b\n4. c', cursor: 8 })
  })
})

describe('numbers and toolbar', () => {
  it('numbers each run from 1', () => {
    expect(renumber('3. a\n7. b\ntext\n5. c')).toBe('1. a\n2. b\ntext\n1. c')
  })
  it('turns lines into a numbered list, and back', () => {
    expect(toggleList('eggs\nmilk\nbread', 0, 15, 'number').text).toBe('1. eggs\n2. milk\n3. bread')
    expect(toggleList('1. eggs\n2. milk', 0, 15, 'number').text).toBe('eggs\nmilk')
  })
  it('works on the line the cursor is in', () => {
    expect(toggleList('a\nb', 2, 2, 'bullet').text).toBe('a\n- b')
  })
  it('ticks and unticks', () => {
    expect(toggleCheck('- [ ] a\n- [x] b', 1)).toBe('- [ ] a\n- [ ] b')
  })
})

describe('display', () => {
  it('groups lines into blocks', () => {
    expect(toBlocks('Intro\n- a\n- b\n\n1. x\n- [x] y').map((b) => b.type)).toEqual([
      'text',
      'bullet',
      'gap',
      'number',
      'check',
    ])
  })
  it('finds bold and links', () => {
    expect(inlinePieces('see **this** at https://x.com/a, ok').map((p) => `${p.type}:${p.value}`)).toEqual([
      'text:see ',
      'bold:this',
      'text: at ',
      'link:https://x.com/a',
      'text:, ok',
    ])
  })
})
