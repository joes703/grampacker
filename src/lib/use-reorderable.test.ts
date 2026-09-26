import { describe, expect, it } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { makeDnDId } from './dnd-ids'
import { makeOptimisticReorder } from './queries/optimistic'
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

// Deleting a category never renumbers the survivors, so sort orders can have
// gaps. A drag must still produce a payload the optimistic reorder accepts -
// it rejects anything but a permutation of the slots the rows already hold.
// /gear once renumbered 0..N-1 here, and every drag after a middle delete
// failed validation with no visible error.
describe('planReorder after a delete left a gap', () => {
  it('reuses the existing slots, so the optimistic reorder accepts the payload', () => {
    const categories = [
      { id: 'shelter', sortOrder: 0 },
      { id: 'kitchen', sortOrder: 2 },
    ]
    const plan = planReorder({
      activeId: makeDnDId('category', 'kitchen'),
      overId: makeDnDId('category', 'shelter'),
      items: categories,
      dndKind: 'category',
    })
    expect(plan).toEqual({
      ok: true,
      updates: [
        { id: 'kitchen', sortOrder: 0 },
        { id: 'shelter', sortOrder: 2 },
      ],
    })

    const qc = new QueryClient()
    qc.setQueryData(['categories'], categories)
    const reorder = makeOptimisticReorder<(typeof categories)[number]>(qc, ['categories'])
    expect(() => plan.ok && reorder.onMutate(plan.updates)).not.toThrow()
  })
})
