import { describe, expect, it } from 'vitest'
import { makeDnDId } from '../lib/dnd-ids'
import type { ListItemWithGear, PackingLocation } from '../lib/types'
import { deriveFilteredItemIds, planListItemReorder } from './ListDetailPage'

function item(
  id: string,
  sortOrder: number,
  flags: { isPacked?: boolean; isReady?: boolean } = {},
): ListItemWithGear {
  return {
    id,
    listId: 'list-1',
    gearItemId: `gear-${id}`,
    quantity: 1,
    isWorn: false,
    isConsumable: false,
    isPacked: flags.isPacked ?? false,
    isReady: flags.isReady ?? false,
    packingLocationId: 'loc-1',
    sortOrder,
    packSortOrder: sortOrder,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    gearItem: {
      id: `gear-${id}`,
      name: id,
      description: null,
      weightGrams: 100,
      categoryId: 'cat-1',
      cost: null,
      purchaseDate: null,
      status: 'active',
      sortOrder: 0,
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    },
  }
}

const visibleFirst = item('visible-first', 1)
const hiddenPacked = item('hidden-packed', 2, { isPacked: true })
const visibleLast = item('visible-last', 3)
const items = [visibleFirst, hiddenPacked, visibleLast]
const locations: PackingLocation[] = [{
  id: 'loc-1',
  name: 'Pack',
  sortOrder: 0,
  containerListItemId: null,
}]
// The planner now returns a TAGGED result, because Pack and List write
// different columns and an untagged array of near-identical shape was too easy
// to post to the wrong endpoint. Pack view's payload is keyed packSortOrder;
// List view's stays sortOrder. The swapped ranks are the same either way -
// what these tests pin is that hidden rows keep their slots.
const expectedPackSwap = {
  kind: 'pack',
  updates: [
    { id: 'visible-last', packSortOrder: 1 },
    { id: 'visible-first', packSortOrder: 3 },
  ],
}
const expectedListSwap = {
  kind: 'list',
  updates: [
    { id: 'visible-last', sortOrder: 1 },
    { id: 'visible-first', sortOrder: 3 },
  ],
}
const expectedSwapFor = (groupingKind: 'location' | 'category') =>
  groupingKind === 'location' ? expectedPackSwap : expectedListSwap

describe('ListDetailPage reorder planning', () => {
  it.each(['location', 'category'] as const)(
    'preserves hidden packed rows when reordering visible %s rows',
    (groupingKind) => {
      expect(planListItemReorder({
        activeId: makeDnDId('item', visibleLast.id),
        overId: makeDnDId('item', visibleFirst.id),
        items,
        groupingKind,
        // Pack for location grouping, and for the category FALLBACK too when the
        // test is exercising a pack surface - mode is what decides which
        // ordering a drag writes now, not groupingKind.
        mode: groupingKind === 'location' ? ('pack' as const) : ('edit' as const),
        locations,
        hiddenItemIds: new Set([hiddenPacked.id]),
      })).toEqual(expectedSwapFor(groupingKind))
    },
  )

  // The reason hiddenItemIds is a SET rather than the old hidePackedItems
  // boolean: there are two filters now, and the planner must not have to know
  // which one hid a row. A row hidden by the un-ready filter has to be skipped
  // exactly like a packed one, or its invisible slot shifts the drop.
  it.each(['location', 'category'] as const)(
    'preserves rows hidden by the un-ready filter when reordering %s rows',
    (groupingKind) => {
      const readyRow = item('hidden-ready', 2, { isReady: true })
      expect(planListItemReorder({
        activeId: makeDnDId('item', visibleLast.id),
        overId: makeDnDId('item', visibleFirst.id),
        items: [visibleFirst, readyRow, visibleLast],
        groupingKind,
        // Pack for location grouping, and for the category FALLBACK too when the
        // test is exercising a pack surface - mode is what decides which
        // ordering a drag writes now, not groupingKind.
        mode: groupingKind === 'location' ? ('pack' as const) : ('edit' as const),
        locations,
        hiddenItemIds: new Set([readyRow.id]),
      })).toEqual(expectedSwapFor(groupingKind))
    },
  )

  it.each(['location', 'category'] as const)(
    'refuses to reorder a hidden row itself in %s grouping',
    (groupingKind) => {
      // Dragging is impossible for a row that is not rendered, but the planner
      // is the last line: a stale drag id must not rewrite sort slots.
      expect(planListItemReorder({
        activeId: makeDnDId('item', hiddenPacked.id),
        overId: makeDnDId('item', visibleFirst.id),
        items,
        groupingKind,
        // Pack for location grouping, and for the category FALLBACK too when the
        // test is exercising a pack surface - mode is what decides which
        // ordering a drag writes now, not groupingKind.
        mode: groupingKind === 'location' ? ('pack' as const) : ('edit' as const),
        locations,
        hiddenItemIds: new Set([hiddenPacked.id]),
      })).toBeNull()
    },
  )
})

describe('deriveFilteredItemIds', () => {
  const packed = item('packed', 1, { isPacked: true })
  const ready = item('ready', 2, { isReady: true })
  const both = item('both', 3, { isPacked: true, isReady: true })
  const neither = item('neither', 4)
  const all = [packed, ready, both, neither]

  it('hides nothing when both filters are off', () => {
    expect(
      deriveFilteredItemIds(all, { showUnpackedOnly: false, showUnreadyOnly: false }),
    ).toEqual(new Set())
  })

  it('hides only packed rows for the unpacked-only filter', () => {
    expect(
      deriveFilteredItemIds(all, { showUnpackedOnly: true, showUnreadyOnly: false }),
    ).toEqual(new Set(['packed', 'both']))
  })

  it('hides only ready rows for the un-ready filter', () => {
    expect(
      deriveFilteredItemIds(all, { showUnpackedOnly: false, showUnreadyOnly: true }),
    ).toEqual(new Set(['ready', 'both']))
  })

  it('ANDs the two filters rather than ORing them', () => {
    // With both on, a row survives only if it is neither packed nor ready -
    // the rows with everything still to do. The failure this pins is the
    // inverted one: OR would leave MORE rows visible as you turn filters on,
    // which is not what a filter switch means.
    expect(
      deriveFilteredItemIds(all, { showUnpackedOnly: true, showUnreadyOnly: true }),
    ).toEqual(new Set(['packed', 'ready', 'both']))
  })
})
