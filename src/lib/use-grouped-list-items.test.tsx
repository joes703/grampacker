// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useGroupedListItems } from './use-grouped-list-items'
import type { Category, ListItemWithGear } from './types'

// The grouping algorithm itself is exhaustively covered in
// `grouping.test.ts`. This file pins the React-hook wrapper's load-bearing
// contracts:
//
//   1. Initial render returns groups sorted by Category.sortOrder with
//      Uncategorized last.
//   2. Re-render with identical inputs returns the SAME top-level array
//      reference (the invariant that keeps the setState-during-render
//      guard from looping; see useGroupedListItems.ts for the React 19
//      reference link).
//   3. Re-render with a render-affecting item change rebuilds the affected
//      group while keeping unchanged groups' references stable.
//   4. A render-affecting field on an item triggers a rebuild even when
//      category membership is unchanged.
//
// The "Worn group" concept is NOT this hook's responsibility — worn-group
// filtering happens in the rendering layer (CategoryGroup.hideWorn,
// SharePage's worn-section flatMap). Asserting it here would just couple
// to the consumer's UI, so it's intentionally out of scope.

function makeCategory(id: string, name: string, sortOrder: number): Category {
  return {
    id,
    name,
    sortOrder,
    createdAt: '2026-01-01T00:00:00.000Z',
  }
}

function makeItem(overrides: {
  id: string
  categoryId: string | null
  sortOrder?: number
  quantity?: number
}): ListItemWithGear {
  return {
    id: overrides.id,
    listId: 'list-1',
    gearItemId: `g-${overrides.id}`,
    quantity: overrides.quantity ?? 1,
    isWorn: false,
    isConsumable: false,
    isPacked: false,
    isReady: false,
    sortOrder: overrides.sortOrder ?? 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    gearItem: {
      id: `g-${overrides.id}`,
      name: `gear-${overrides.id}`,
      description: null,
      weightGrams: 100,
      categoryId: overrides.categoryId,
      cost: null,
      purchaseDate: null,
      status: 'active',
      sortOrder: 0,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  }
}

afterEach(() => {
  cleanup()
})

describe('useGroupedListItems', () => {
  it('emits categories in sortOrder with Uncategorized last on first render', () => {
    const shelter = makeCategory('cat-shelter', 'Shelter', 0)
    const kitchen = makeCategory('cat-kitchen', 'Kitchen', 1)
    const items = [
      makeItem({ id: 'a', categoryId: 'cat-kitchen' }),
      makeItem({ id: 'b', categoryId: 'cat-shelter' }),
      makeItem({ id: 'c', categoryId: null }),
    ]
    // Pass categories OUT of sort order to confirm the hook sorts.
    const { result } = renderHook(() => useGroupedListItems(items, [kitchen, shelter]))

    expect(result.current).toHaveLength(3)
    expect(result.current[0]?.category?.id).toBe('cat-shelter')
    expect(result.current[1]?.category?.id).toBe('cat-kitchen')
    expect(result.current[2]?.category).toBeNull() // Uncategorized last
    expect(result.current[2]?.items.map((i) => i.id)).toEqual(['c'])
  })

  it('routes items with an orphan categoryId (missing from categories) into Uncategorized', () => {
    const shelter = makeCategory('cat-shelter', 'Shelter', 0)
    const items = [
      makeItem({ id: 'a', categoryId: 'cat-shelter' }),
      // categoryId points at something that isn't in the categories array.
      makeItem({ id: 'b', categoryId: 'cat-deleted' }),
    ]
    const { result } = renderHook(() => useGroupedListItems(items, [shelter]))

    expect(result.current).toHaveLength(2)
    expect(result.current[1]?.category).toBeNull()
    expect(result.current[1]?.items.map((i) => i.id)).toEqual(['b'])
  })

  it('drops empty categories from the result (list view does not show empty sections)', () => {
    const shelter = makeCategory('cat-shelter', 'Shelter', 0)
    const kitchen = makeCategory('cat-kitchen', 'Kitchen', 1) // no items
    const { result } = renderHook(() =>
      useGroupedListItems([makeItem({ id: 'a', categoryId: 'cat-shelter' })], [shelter, kitchen]),
    )

    expect(result.current).toHaveLength(1)
    expect(result.current[0]?.category?.id).toBe('cat-shelter')
  })

  it('returns the SAME top-level array reference when inputs are unchanged across renders', () => {
    // The load-bearing invariant: without same-ref return, the hook's
    // `if (next !== cached) setCached(next)` would fire every render and
    // loop. This is what keeps React 19 from screaming about
    // setState-during-render.
    const shelter = makeCategory('cat-shelter', 'Shelter', 0)
    const items = [
      makeItem({ id: 'a', categoryId: 'cat-shelter' }),
      makeItem({ id: 'b', categoryId: 'cat-shelter' }),
    ]

    const { result, rerender } = renderHook(
      ({ items, cats }: { items: ListItemWithGear[]; cats: Category[] }) =>
        useGroupedListItems(items, cats),
      { initialProps: { items, cats: [shelter] } },
    )

    const first = result.current
    rerender({ items, cats: [shelter] })
    expect(result.current).toBe(first)
  })

  it('rebuilds only the affected group when one item changes; other groups keep their reference', () => {
    const shelter = makeCategory('cat-shelter', 'Shelter', 0)
    const kitchen = makeCategory('cat-kitchen', 'Kitchen', 1)
    const original: ListItemWithGear[] = [
      makeItem({ id: 'a', categoryId: 'cat-shelter', quantity: 1 }),
      makeItem({ id: 'b', categoryId: 'cat-kitchen', quantity: 1 }),
    ]
    const { result, rerender } = renderHook(
      ({ items }: { items: ListItemWithGear[] }) => useGroupedListItems(items, [shelter, kitchen]),
      { initialProps: { items: original } },
    )

    const shelterGroup1 = result.current[0]
    const kitchenGroup1 = result.current[1]

    // Mutate quantity on the Kitchen item only. Render-affecting per
    // grouping.ts's comparator -> Kitchen group rebuilds; Shelter
    // keeps its prior reference.
    const next: ListItemWithGear[] = [
      original[0]!,
      { ...original[1]!, quantity: 5 },
    ]
    rerender({ items: next })

    expect(result.current[0]).toBe(shelterGroup1) // unchanged group: same ref
    expect(result.current[1]).not.toBe(kitchenGroup1) // changed group: new ref
    expect(result.current[1]?.items[0]?.quantity).toBe(5)
  })

  it('returns the same top-level reference even when an unrelated, non-render-affecting field changes', () => {
    // updatedAt is not in the comparator's whitelist (grouping.ts
    // `listItemsArrayEqual` only compares fields the row actually
    // renders). So a bumped updatedAt should NOT rebuild the group
    // or the top-level array.
    const shelter = makeCategory('cat-shelter', 'Shelter', 0)
    const item = makeItem({ id: 'a', categoryId: 'cat-shelter' })
    const { result, rerender } = renderHook(
      ({ items }: { items: ListItemWithGear[] }) => useGroupedListItems(items, [shelter]),
      { initialProps: { items: [item] } },
    )

    const first = result.current
    // New array object, new item object — but identical render-relevant
    // fields. Stability comparator should make this a no-op.
    const sameRenderShape: ListItemWithGear = { ...item, updatedAt: '2099-01-01T00:00:00.000Z' }
    rerender({ items: [sameRenderShape] })

    expect(result.current).toBe(first)
  })

  it('handles an empty items list (no categories emitted) without throwing', () => {
    const shelter = makeCategory('cat-shelter', 'Shelter', 0)
    const { result } = renderHook(() => useGroupedListItems([], [shelter]))
    expect(result.current).toEqual([])
  })
})
