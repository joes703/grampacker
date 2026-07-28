import { describe, expect, it } from 'vitest'
import type { ListItemWithGear, PackingLocation } from '../lib/types'
import {
  findBackedLocation,
  hasListItemEdits,
  snapshotListItem,
} from './use-list-item-removal'

// Removing an item from a list used to open a red confirm every single time,
// from all four entry points (picker unpick, row kebab, mobile swipe, edit
// dialog). Then it became a DIRTY-STATE confirm - one that appeared only when
// the membership row had something to lose - which read from the outside as
// confirming at random.
//
// Now removal is immediate with an Undo toast, and hasListItemEdits has a
// different job: it decides whether Undo needs a restore PATCH at all. A
// pristine row needs only the re-add.
//
// "Sometimes X" is exactly the kind of behavior that rots silently, so every
// field is still pinned individually: add a field to the membership row
// without adding it here and Undo starts dropping it on the floor.

const pristine: ListItemWithGear = {
  id: 'li-1',
  listId: 'list-1',
  gearItemId: 'gear-1',
  quantity: 1,
  isWorn: false,
  isConsumable: false,
  isPacked: false,
  isReady: false,
  packingLocationId: null,
  sortOrder: 0,
  createdAt: '2026-06-06T00:00:00.000Z',
  updatedAt: '2026-06-06T00:00:00.000Z',
  gearItem: {
    id: 'gear-1',
    categoryId: 'cat-1',
    name: 'Tarp',
    description: null,
    weightGrams: 250.5,
    cost: null,
    purchaseDate: null,
    status: 'active',
    sortOrder: 0,
    createdAt: '2026-06-06T00:00:00.000Z',
    updatedAt: '2026-06-06T00:00:00.000Z',
  },
}

describe('hasListItemEdits', () => {
  it('treats a freshly added, untouched item as pristine', () => {
    // The bulk-curation case: pick, look at it, unpick. Undo has nothing to
    // restore beyond the row, so it skips the second request.
    expect(hasListItemEdits(pristine)).toBe(false)
  })

  it('ignores gear-level detail the removal cannot destroy', () => {
    // Weight, cost and description live on the GEAR row, which survives the
    // removal untouched. Only membership state needs restoring.
    expect(
      hasListItemEdits({
        ...pristine,
        gearItem: { ...pristine.gearItem, name: 'Renamed', weightGrams: 999, cost: 4200 },
      }),
    ).toBe(false)
  })

  it.each([
    ['quantity', { quantity: 3 }],
    ['isWorn', { isWorn: true }],
    ['isConsumable', { isConsumable: true }],
    ['isPacked', { isPacked: true }],
    ['isReady', { isReady: true }],
    ['packingLocationId', { packingLocationId: 'loc-1' }],
  ])('needs a restore patch when %s carries user state', (_field, patch) => {
    expect(hasListItemEdits({ ...pristine, ...patch })).toBe(true)
  })

  it('deliberately ignores sortOrder', () => {
    // Flagged in review as a field removal silently discards, and it is -
    // dragging a row rewrites sortOrder, so removing a positioned row loses
    // that position, and Undo cannot restore it either (the server assigns a
    // fresh sortOrder on create, landing the row at the end of its section).
    // It stays excluded because there is nothing a restore patch could do
    // about it. This test exists so that stays a decision, not an oversight.
    expect(hasListItemEdits({ ...pristine, sortOrder: 7 })).toBe(false)
  })

  it('treats an explicit quantity of 1 as pristine, not as an edit', () => {
    // 1 is the server default, so it says nothing about user intent.
    expect(hasListItemEdits({ ...pristine, quantity: 1 })).toBe(false)
  })
})

describe('snapshotListItem', () => {
  it('carries no patch for a pristine row', () => {
    expect(snapshotListItem(pristine)).toEqual({
      gearItemId: 'gear-1',
      name: 'Tarp',
      patch: null,
    })
  })

  it('captures every restorable field, not just the ones that differ', () => {
    // The patch is a full restore, not a diff: sending only the changed
    // fields would work today but would silently stop restoring a field the
    // moment its default changed server-side.
    const edited: ListItemWithGear = {
      ...pristine,
      quantity: 4,
      isConsumable: true,
      isPacked: true,
      isReady: true,
      packingLocationId: 'loc-9',
    }

    expect(snapshotListItem(edited).patch).toEqual({
      quantity: 4,
      isWorn: false,
      isConsumable: true,
      isPacked: true,
      isReady: true,
      packingLocationId: 'loc-9',
    })
  })

  it('reads the name off the gear item so the toast survives the delete', () => {
    // The snapshot is taken BEFORE the row leaves the cache; the toast that
    // names the item renders after. Holding the string, not a reference into
    // the cache, is what makes that safe.
    expect(snapshotListItem(pristine).name).toBe('Tarp')
  })
})

describe('findBackedLocation', () => {
  const locations: PackingLocation[] = [
    { id: 'loc-plain', name: 'Main pack', sortOrder: 0, containerListItemId: null },
    { id: 'loc-canister', name: 'Bear canister', sortOrder: 1, containerListItemId: 'li-canister' },
  ]

  it('finds the location an item backs', () => {
    // This is the whole trigger for the one surviving confirm dialog:
    // removing li-canister cascade-deletes loc-canister and orphans its
    // contents, which Undo cannot rebuild.
    expect(findBackedLocation('li-canister', locations)?.name).toBe('Bear canister')
  })

  it('returns null for an ordinary item', () => {
    expect(findBackedLocation('li-1', locations)).toBeNull()
  })

  it('does not mistake an item ASSIGNED to a location for one BACKING it', () => {
    // packingLocationId (where an item sits) and containerListItemId (what an
    // item contains) are opposite directions. Confusing them would put the
    // confirm dialog in front of every packed item.
    expect(findBackedLocation('loc-plain', locations)).toBeNull()
  })

  it('returns null when the list has no locations at all', () => {
    expect(findBackedLocation('li-canister', [])).toBeNull()
  })

  it('cannot distinguish "no locations" from "locations not loaded yet"', () => {
    // This is the whole reason ListDetailPage resolves the locations query via
    // ensureQueryData before deciding, instead of reading the render's array.
    // An empty array is the loading state AND the genuinely-empty state, and
    // this predicate answers "not a container" to both. The locations query is
    // not part of detailDataLoading, so rows are removable while it is still
    // in flight - and answering "not a container" there would skip the confirm
    // and cascade a location away with no warning and no undo.
    const notLoadedYet: PackingLocation[] = []
    expect(findBackedLocation('li-canister', notLoadedYet)).toBeNull()
    expect(findBackedLocation('li-canister', locations)).not.toBeNull()
  })
})
