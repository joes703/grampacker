import { describe, expect, it } from 'vitest'
import type { Category, PackingLocation } from '../lib/types'
import { orderPackGroups, selectPackGrouping, selectPackGroupingState } from './packing-grouping'

const categories: Category[] = [
  { id: 'cat-1', name: 'Shelter', sortOrder: 0, createdAt: '2026-01-01' },
]
const locations: PackingLocation[] = [
  { id: 'loc-1', name: 'Main pack', sortOrder: 0 },
]

describe('selectPackGrouping', () => {
  it('falls back to categories before any successful locations result', () => {
    expect(selectPackGrouping(categories, undefined)).toEqual({
      kind: 'category',
      groups: categories,
    })
  })

  it('uses categories after a successful empty locations result', () => {
    expect(selectPackGrouping(categories, [])).toEqual({
      kind: 'category',
      groups: categories,
    })
  })

  it('keeps using cached locations independently of a later query error flag', () => {
    expect(selectPackGrouping(categories, locations)).toEqual({
      kind: 'location',
      groups: locations,
    })
  })

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

describe('orderPackGroups', () => {
  const assigned = { group: locations[0], items: ['assigned'] }
  const unassigned = { group: null, items: ['unassigned'] }

  it('puts Unassigned first when Pack is grouped by location', () => {
    expect(orderPackGroups([assigned, unassigned], 'location')).toEqual([
      unassigned,
      assigned,
    ])
  })

  it('leaves Uncategorized last when Pack falls back to category grouping', () => {
    expect(orderPackGroups([assigned, unassigned], 'category')).toEqual([
      assigned,
      unassigned,
    ])
  })
})
