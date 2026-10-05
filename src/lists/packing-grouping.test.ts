import { describe, expect, it } from 'vitest'
import type { Category, PackingLocation } from '../lib/types'
import { selectPackGroupingState } from './packing-grouping'

const categories: Category[] = [
  { id: 'cat-1', name: 'Shelter', sortOrder: 0, createdAt: '2026-01-01' },
]
const locations: PackingLocation[] = [
  { id: 'loc-1', name: 'Main pack', sortOrder: 0, containerListItemId: null },
]

// selectPackGrouping's only caller is selectPackGroupingState, so it is proven
// through it.
describe('selectPackGrouping', () => {
  it('first-load error uses category fallback and shows the load notice', () => {
    expect(selectPackGroupingState(categories, { data: undefined, isError: true })).toEqual({
      grouping: { kind: 'category', groups: categories },
      showErrorNotice: true,
    })
  })

  it('background-refetch error keeps cached locations and layers the notice', () => {
    expect(selectPackGroupingState(categories, { data: locations, isError: true })).toEqual({
      grouping: { kind: 'location', groups: locations },
      showErrorNotice: true,
    })
  })

  it('successful empty means category grouping without an error notice', () => {
    expect(selectPackGroupingState(categories, { data: [], isError: false })).toEqual({
      grouping: { kind: 'category', groups: categories },
      showErrorNotice: false,
    })
  })
})
