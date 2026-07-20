import { describe, expect, it } from 'vitest'
import type { ListItemWithGear } from '../lib/types'
import { hasListItemEdits } from './ListDetailPage'

// Removing an item from a list used to open a red `dangerous` confirm every
// single time, from all four entry points (picker unpick, row kebab, mobile
// swipe, edit dialog). That is friction with nothing behind it: the gear stays
// in the inventory, so nothing is destroyed.
//
// It is not quite nothing, though. The membership row holds state the user
// entered - quantity, worn/consumable, pack/ready progress - and there is no
// undo affordance. So the confirm became a DIRTY-STATE confirm: it appears
// only when the row has something to lose.
//
// This predicate is the whole rule. "Sometimes confirms" is exactly the kind
// of behavior that rots silently, so every field is pinned individually: add a
// field to the membership row without adding it here and the removal starts
// eating it without asking.

const pristine: ListItemWithGear = {
  id: 'li-1',
  listId: 'list-1',
  gearItemId: 'gear-1',
  quantity: 1,
  isWorn: false,
  isConsumable: false,
  isPacked: false,
  isReady: false,
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
    // The bulk-curation case: pick, look at it, unpick. No confirm.
    expect(hasListItemEdits(pristine)).toBe(false)
  })

  it('does not confirm on gear-level detail the removal cannot destroy', () => {
    // Weight, cost and description live on the GEAR row, which survives the
    // removal untouched. Only membership state should trigger a confirm.
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
  ])('confirms when %s carries user state', (_field, patch) => {
    expect(hasListItemEdits({ ...pristine, ...patch })).toBe(true)
  })

  it('deliberately ignores sortOrder', () => {
    // Flagged in review as a field the removal silently discards, and it is -
    // dragging a row rewrites sortOrder, so removing a positioned row loses
    // that position. It stays excluded anyway: sortOrder is ALSO server-
    // assigned on add, with no provenance bit to tell the two apart, so
    // treating it as dirty would confirm on nearly every item of a reordered
    // list and undo the whole point. A confirm would not restore the position
    // either. This test exists so that stays a decision, not an oversight.
    expect(hasListItemEdits({ ...pristine, sortOrder: 7 })).toBe(false)
  })

  it('treats an explicit quantity of 1 as pristine, not as an edit', () => {
    // 1 is the server default, so it says nothing about user intent.
    expect(hasListItemEdits({ ...pristine, quantity: 1 })).toBe(false)
  })
})
