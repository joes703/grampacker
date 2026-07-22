import { describe, expect, it } from 'vitest'
import type { ListItemWithGear, PackingLocation } from '../lib/types'
import { buildContainerMoveExclusions, buildPackingTree } from './packing-tree'

function item(
  id: string,
  packingLocationId: string | null,
  sortOrder: number,
): ListItemWithGear {
  return {
    id,
    listId: 'list-1',
    gearItemId: `gear-${id}`,
    quantity: 1,
    isWorn: false,
    isConsumable: false,
    isPacked: false,
    isReady: false,
    packingLocationId,
    sortOrder,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    gearItem: {
      id: `gear-${id}`,
      name: id,
      description: null,
      weightGrams: 100,
      categoryId: null,
      cost: null,
      purchaseDate: null,
      status: 'active',
      sortOrder,
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    },
  }
}

function location(
  id: string,
  containerListItemId: string | null,
  sortOrder: number,
): PackingLocation {
  return { id, name: id, containerListItemId, sortOrder }
}

describe('buildPackingTree', () => {
  it('turns an unassigned backing item into one root container instead of a duplicate row', () => {
    const tree = buildPackingTree(
      [item('pack', null, 0), item('sleeping-bag', 'loc-pack', 1)],
      [location('loc-pack', 'pack', 0)],
    )

    expect(tree.unassignedItems).toEqual([])
    expect(tree.roots).toHaveLength(1)
    expect(tree.roots[0]?.containerItem?.id).toBe('pack')
    expect(tree.roots[0]?.items.map((entry) => entry.id)).toEqual(['sleeping-bag'])
  })

  it('nests an item-backed container under the location containing its backing item', () => {
    const tree = buildPackingTree(
      [
        item('pack', null, 0),
        item('bear-can', 'loc-pack', 1),
        item('food', 'loc-can', 2),
      ],
      [
        location('loc-pack', 'pack', 0),
        location('loc-can', 'bear-can', 1),
      ],
    )

    const pack = tree.roots[0]
    const canister = pack?.children[0]
    expect(pack?.containerItem?.id).toBe('pack')
    expect(pack?.items).toEqual([])
    expect(canister?.containerItem?.id).toBe('bear-can')
    expect(canister?.items.map((entry) => entry.id)).toEqual(['food'])

    const visibleIds = [
      ...tree.unassignedItems.map((entry) => entry.id),
      ...tree.roots.flatMap((root) => [
        root.containerItem?.id,
        ...root.items.map((entry) => entry.id),
        ...root.children.flatMap((child) => [
          child.containerItem?.id,
          ...child.items.map((entry) => entry.id),
        ]),
      ]),
    ]
    expect(visibleIds).toEqual(['pack', 'bear-can', 'food'])

    const exclusions = buildContainerMoveExclusions(tree)
    expect([...exclusions.get('pack') ?? []]).toEqual(['loc-pack', 'loc-can'])
    expect([...exclusions.get('bear-can') ?? []]).toEqual(['loc-can'])
  })

  it('keeps name-only locations at the root and routes orphaned items to Unassigned', () => {
    const tree = buildPackingTree(
      [item('poles', 'loc-pockets', 0), item('orphan', 'loc-deleted', 1)],
      [location('loc-pockets', null, 0)],
    )

    expect(tree.roots[0]?.containerItem).toBeNull()
    expect(tree.roots[0]?.items.map((entry) => entry.id)).toEqual(['poles'])
    expect(tree.unassignedItems.map((entry) => entry.id)).toEqual(['orphan'])
  })

  it('places a newly promoted root before older location roots', () => {
    const tree = buildPackingTree(
      [item('pack', null, 0)],
      [
        location('loc-existing', null, 0),
        location('loc-pack', 'pack', -1),
      ],
    )

    expect(tree.roots.map((node) => node.location.id)).toEqual([
      'loc-pack',
      'loc-existing',
    ])
  })

  it('fails safe to root containers if optimistic data contains a cycle', () => {
    const tree = buildPackingTree(
      [item('pack', 'loc-can', 0), item('bear-can', 'loc-pack', 1)],
      [
        location('loc-pack', 'pack', 0),
        location('loc-can', 'bear-can', 1),
      ],
    )

    expect(tree.roots.map((node) => node.location.id)).toEqual(['loc-pack', 'loc-can'])
  })

  it('filters worn rows from Organize, including a location backing item', () => {
    const wornPack = { ...item('pack', null, 0), isWorn: true }
    const wornHat = { ...item('hat', 'loc-pack', 1), isWorn: true }
    const tree = buildPackingTree(
      [wornPack, wornHat, item('stove', 'loc-pack', 2)],
      [location('loc-pack', 'pack', 0)],
      { includeItem: (entry) => !entry.isWorn },
    )

    expect(tree.roots[0]?.containerItem).toBeNull()
    expect(tree.roots[0]?.items.map((entry) => entry.id)).toEqual(['stove'])
    expect(tree.unassignedItems).toEqual([])
  })
})
