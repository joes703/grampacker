import { describe, it, expect } from 'vitest'
import { assignSortOrderSlots } from './grouping'

// assignSortOrderSlots redistributes EXISTING sort_order slot values among
// a re-ordered subset of items. It does NOT renumber to 0..N-1; it sorts
// the input items' existing sort_order values ascending and pairs each
// slot, in order, with the corresponding input item in input order. This
// is what lets a within-category reorder persist new positions without
// renumbering items that weren't part of the drag.
describe('assignSortOrderSlots', () => {
  it('redistributes existing slots ascending across reversed input', () => {
    const result = assignSortOrderSlots([
      { id: 'a', sort_order: 30 },
      { id: 'b', sort_order: 10 },
      { id: 'c', sort_order: 20 },
    ])
    expect(result).toEqual([
      { id: 'a', sort_order: 10 },
      { id: 'b', sort_order: 20 },
      { id: 'c', sort_order: 30 },
    ])
  })

  it('preserves id↔slot pairing when input order already matches sorted slots', () => {
    const result = assignSortOrderSlots([
      { id: 'a', sort_order: 10 },
      { id: 'b', sort_order: 20 },
      { id: 'c', sort_order: 30 },
    ])
    expect(result).toEqual([
      { id: 'a', sort_order: 10 },
      { id: 'b', sort_order: 20 },
      { id: 'c', sort_order: 30 },
    ])
  })

  it('preserves non-contiguous slot values rather than renumbering to 0..N-1', () => {
    const result = assignSortOrderSlots([
      { id: 'a', sort_order: 1000 },
      { id: 'b', sort_order: 500 },
    ])
    expect(result).toEqual([
      { id: 'a', sort_order: 500 },
      { id: 'b', sort_order: 1000 },
    ])
  })

  it('returns empty array for empty input', () => {
    expect(assignSortOrderSlots([])).toEqual([])
  })

  it('returns single item unchanged when input has one element', () => {
    expect(
      assignSortOrderSlots([{ id: 'a', sort_order: 42 }]),
    ).toEqual([{ id: 'a', sort_order: 42 }])
  })

  it('drops fields beyond id and sort_order from the return shape', () => {
    const result = assignSortOrderSlots([
      { id: 'a', sort_order: 10, name: 'Alpha', extra: 'kept-on-input' },
      { id: 'b', sort_order: 5, name: 'Beta', extra: 'also-on-input' },
    ])
    expect(result).toEqual([
      { id: 'a', sort_order: 5 },
      { id: 'b', sort_order: 10 },
    ])
    // Stronger: confirm the extras are not on the output objects.
    expect(result[0]).not.toHaveProperty('name')
    expect(result[0]).not.toHaveProperty('extra')
  })
})
