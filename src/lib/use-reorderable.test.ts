import { describe, it, expect } from 'vitest'
import { planReorder } from './use-reorderable'
import { makeDnDId } from './dnd-ids'
import { assignSortOrderSlots } from './grouping'

type Row = { id: string; name: string; sort_order: number }

function rows(): Row[] {
  return [
    { id: 'A', name: 'a', sort_order: 10 },
    { id: 'B', name: 'b', sort_order: 20 },
    { id: 'C', name: 'c', sort_order: 30 },
  ]
}

const KIND = 'list-card'
const id = (raw: string) => makeDnDId(KIND, raw)

describe('planReorder', () => {
  it('rejects when there is no over id', () => {
    const r = planReorder<Row>({
      activeId: id('A'),
      overId: undefined,
      items: rows(),
      dndKind: KIND,
    })
    expect(r).toEqual({ ok: false })
  })

  it('rejects when active id equals over id (drop on self)', () => {
    const r = planReorder<Row>({
      activeId: id('B'),
      overId: id('B'),
      items: rows(),
      dndKind: KIND,
    })
    expect(r).toEqual({ ok: false })
  })

  it('rejects an invalid active kind (kind mismatch)', () => {
    const r = planReorder<Row>({
      activeId: makeDnDId('gear-item', 'A'),
      overId: id('B'),
      items: rows(),
      dndKind: KIND,
    })
    expect(r).toEqual({ ok: false })
  })

  it('rejects an invalid over kind (kind mismatch)', () => {
    const r = planReorder<Row>({
      activeId: id('A'),
      overId: makeDnDId('gear-item', 'B'),
      items: rows(),
      dndKind: KIND,
    })
    expect(r).toEqual({ ok: false })
  })

  it('rejects when the active id is not in items (stale)', () => {
    const r = planReorder<Row>({
      activeId: id('Z'),
      overId: id('B'),
      items: rows(),
      dndKind: KIND,
    })
    expect(r).toEqual({ ok: false })
  })

  it('rejects when the over id is not in items (stale)', () => {
    const r = planReorder<Row>({
      activeId: id('A'),
      overId: id('Z'),
      items: rows(),
      dndKind: KIND,
    })
    expect(r).toEqual({ ok: false })
  })

  it('on a valid move, returns updates from the default buildUpdates (assignSortOrderSlots)', () => {
    const r = planReorder<Row>({
      activeId: id('A'),
      overId: id('C'),
      items: rows(),
      dndKind: KIND,
    })
    // arrayMove([A,B,C], 0, 2) => [B,C,A]
    // assignSortOrderSlots permutes the existing slot values [10,20,30]
    // in the new order: B->10, C->20, A->30.
    expect(r).toEqual({
      ok: true,
      updates: assignSortOrderSlots([
        { id: 'B', name: 'b', sort_order: 20 },
        { id: 'C', name: 'c', sort_order: 30 },
        { id: 'A', name: 'a', sort_order: 10 },
      ]),
    })
    // Sanity check the algebra explicitly so a future change to
    // assignSortOrderSlots can't make this test pass on a different
    // promise. The slot values must permute, not renumber.
    if (r.ok) {
      const sortValues = r.updates.map((u) => u.sort_order).sort((a, b) => a - b)
      expect(sortValues).toEqual([10, 20, 30])
    }
  })

  it('honors a custom buildUpdates (the /gear category renumber-from-zero shape)', () => {
    const r = planReorder<Row>({
      activeId: id('A'),
      overId: id('C'),
      items: rows(),
      dndKind: KIND,
      buildUpdates: (reordered) => reordered.map((row, i) => ({ id: row.id, sort_order: i })),
    })
    expect(r).toEqual({
      ok: true,
      updates: [
        { id: 'B', sort_order: 0 },
        { id: 'C', sort_order: 1 },
        { id: 'A', sort_order: 2 },
      ],
    })
  })
})
