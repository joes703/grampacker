import { describe, expect, it } from 'vitest'
import { makeDnDId } from './dnd-ids'
import { planReorder } from './use-reorderable'

const locations = [
  { id: 'loc-pack', sortOrder: -1 },
  { id: 'loc-pot', sortOrder: 0 },
]

describe('planReorder item-backed locations', () => {
  it('reorders the location identity while leaving the item identity for nesting', () => {
    expect(planReorder({
      activeId: makeDnDId('packing-location', 'loc-pack'),
      overId: makeDnDId('packing-location', 'loc-pot'),
      items: locations,
      dndKind: 'packing-location',
    })).toEqual({
      ok: true,
      updates: [
        { id: 'loc-pot', sortOrder: -1 },
        { id: 'loc-pack', sortOrder: 0 },
      ],
    })

    expect(planReorder({
      activeId: makeDnDId('packing-item', 'item-pack'),
      overId: makeDnDId('packing-location', 'loc-pot'),
      items: locations,
      dndKind: 'packing-location',
    })).toEqual({ ok: false })
  })
})
