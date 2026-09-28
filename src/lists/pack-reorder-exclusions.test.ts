import { describe, expect, it } from 'vitest'
import type { ListItemWithGear, PackingLocation } from '../lib/types'
import { buildPackingTree, derivePackReorderExclusions } from './packing-tree'

function item(id: string, packingLocationId: string | null, isWorn = false): ListItemWithGear {
  return {
    id,
    listId: 'list-1',
    gearItemId: `gear-${id}`,
    quantity: 1,
    isWorn,
    isConsumable: false,
    isPacked: false,
    isReady: false,
    packingLocationId,
    sortOrder: 0,
    packSortOrder: 0,
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
      sortOrder: 0,
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    },
  }
}

function renderedRowIds(items: ListItemWithGear[], locations: PackingLocation[]): string[] {
  const tree = buildPackingTree(items, locations, {
    includeItem: (row) => !row.isWorn,
  })
  const ids = tree.unassignedItems.map((row) => row.id)
  const visit = (nodes: typeof tree.roots) => {
    for (const node of nodes) {
      ids.push(...node.items.map((row) => row.id))
      visit(node.children)
    }
  }
  visit(tree.roots)
  return ids.sort()
}

// The reorder planners must plan against exactly the rows buildPackingTree
// renders inside locations (with the page's worn filter), so the exclusion set
// is everything else. Consistency coverage for the shared rule; the page-level
// regression for a drag during a pending promotion is
// ListDetailPage.pending-container.test.tsx.
describe('packing reorder exclusions', () => {
  it('exclude exactly the rows the packing tree does not render as rows', () => {
    const items = [
      item('a', 'loc-1'),
      item('b', null),
      item('worn', 'loc-1', true),
      item('bag', 'loc-1'),
      item('pending-bag', null),
    ]
    const locations: PackingLocation[] = [
      { id: 'loc-1', name: 'Backpack', sortOrder: 0, containerListItemId: null },
      { id: 'loc-2', name: 'bag', sortOrder: 1, containerListItemId: 'bag' },
      // A promotion the server has not confirmed yet: already a header.
      { id: 'temp-1', name: 'pending-bag', sortOrder: -1, containerListItemId: 'pending-bag' },
    ]

    const exclusions = derivePackReorderExclusions(items, locations)

    expect([...exclusions].sort()).toEqual(['bag', 'pending-bag', 'worn'])
    expect(renderedRowIds(items, locations)).toEqual(
      items.map((row) => row.id).filter((id) => !exclusions.has(id)).sort(),
    )
  })
})
