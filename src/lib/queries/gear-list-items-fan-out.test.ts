import { describe, it, expect, vi, afterEach } from 'vitest'
import { QueryClient } from '@tanstack/react-query'

vi.mock('../toast', () => ({
  showToast: vi.fn(),
}))

import {
  makeOptimisticGearItemUpdate,
  makeOptimisticGearItemDelete,
  makeOptimisticGearItemsBulkDelete,
  makeOptimisticGearItemsBulkCategoryMove,
} from './gear-list-items-fan-out'
import { queryKeys } from './keys'
import { showToast } from '../toast'
import type { GearItem } from './gear'
import type { ListItemWithGear } from './list-items'

// Cross-cache lifecycle regressions for the gear fan-out: every helper
// must apply the same logical change to the gear library cache AND every
// per-list cache embedding the gear, snapshot exactly the caches it
// touched, restore all of them on error, and leave unaffected caches
// untouched BY IDENTITY (a churned reference re-renders an unrelated
// open list for nothing).

const NOW = '2026-01-01T00:00:00.000Z'

function gear(over: Partial<GearItem> = {}): GearItem {
  return {
    id: 'g1', categoryId: 'c1', name: 'Tent', description: null,
    weightGrams: 1200, cost: null, purchaseDate: null, status: 'active',
    sortOrder: 0, createdAt: NOW, updatedAt: NOW, ...over,
  }
}

function listItem(over: Partial<ListItemWithGear> = {}): ListItemWithGear {
  const g = over.gearItem ?? gear()
  return {
    id: `li-${g.id}`, listId: 'l1', gearItemId: g.id, quantity: 1,
    isWorn: false, isConsumable: false, isPacked: false, isReady: false,
    sortOrder: 0, createdAt: NOW, updatedAt: NOW, gearItem: g, ...over,
  }
}

// Two lists reference g1 (l1 also has g2); a third list references only
// g3 and must never be touched by g1/g2 mutations.
function seed() {
  const qc = new QueryClient()
  const g1 = gear({ id: 'g1', name: 'Tent' })
  const g2 = gear({ id: 'g2', name: 'Quilt' })
  const g3 = gear({ id: 'g3', name: 'Stove' })
  qc.setQueryData(queryKeys.gearItems(), [g1, g2, g3])
  qc.setQueryData(queryKeys.listItems('l1'), [
    listItem({ id: 'li-1', listId: 'l1', gearItemId: 'g1', gearItem: g1 }),
    listItem({ id: 'li-2', listId: 'l1', gearItemId: 'g2', gearItem: g2 }),
  ])
  qc.setQueryData(queryKeys.listItems('l2'), [
    listItem({ id: 'li-3', listId: 'l2', gearItemId: 'g1', gearItem: g1, quantity: 2 }),
  ])
  qc.setQueryData(queryKeys.listItems('l3'), [
    listItem({ id: 'li-4', listId: 'l3', gearItemId: 'g3', gearItem: g3 }),
  ])
  return { qc }
}

function gearCache(qc: QueryClient): GearItem[] {
  return qc.getQueryData<GearItem[]>(queryKeys.gearItems())!
}

function itemsOf(qc: QueryClient, listId: string): ListItemWithGear[] {
  return qc.getQueryData<ListItemWithGear[]>(queryKeys.listItems(listId))!
}

afterEach(() => vi.clearAllMocks())

describe('makeOptimisticGearItemUpdate', () => {
  it('patches the gear cache and the embedded copy in every affected list', () => {
    const { qc } = seed()
    const { onMutate } = makeOptimisticGearItemUpdate({ qc })

    onMutate({ id: 'g1', patch: { name: 'Mid', weightGrams: 900 } })

    expect(gearCache(qc).find((g) => g.id === 'g1')).toMatchObject({
      name: 'Mid', weightGrams: 900,
    })
    expect(itemsOf(qc, 'l1').find((i) => i.gearItemId === 'g1')?.gearItem)
      .toMatchObject({ name: 'Mid', weightGrams: 900 })
    expect(itemsOf(qc, 'l2')[0]?.gearItem).toMatchObject({ name: 'Mid' })
    // The other row in l1 is not the target and keeps its gear.
    expect(itemsOf(qc, 'l1').find((i) => i.gearItemId === 'g2')?.gearItem.name)
      .toBe('Quilt')
  })

  it('never overwrites an embedded field with undefined (PATCH semantics)', () => {
    const { qc } = seed()
    const { onMutate } = makeOptimisticGearItemUpdate({ qc })

    onMutate({ id: 'g1', patch: { weightGrams: 900, name: undefined } })

    expect(itemsOf(qc, 'l2')[0]?.gearItem).toMatchObject({
      name: 'Tent', weightGrams: 900,
    })
  })

  it('leaves unrelated list caches untouched by identity', () => {
    const { qc } = seed()
    const before = itemsOf(qc, 'l3')
    const { onMutate } = makeOptimisticGearItemUpdate({ qc })

    const ctx = onMutate({ id: 'g1', patch: { name: 'Mid' } })

    expect(itemsOf(qc, 'l3')).toBe(before) // same reference: no snapshot, no write
    expect(ctx.listSnapshots.map((s) => s.key)).toEqual([
      queryKeys.listItems('l1'),
      queryKeys.listItems('l2'),
    ])
  })

  it('onError restores the gear cache and every touched list cache exactly', () => {
    const { qc } = seed()
    const gearBefore = gearCache(qc)
    const l1Before = itemsOf(qc, 'l1')
    const l2Before = itemsOf(qc, 'l2')
    const { onMutate, onError } = makeOptimisticGearItemUpdate({ qc })

    const ctx = onMutate({ id: 'g1', patch: { name: 'Mid' } })
    onError(new Error('nope'), { id: 'g1', patch: { name: 'Mid' } }, ctx)

    expect(gearCache(qc)).toEqual(gearBefore)
    expect(itemsOf(qc, 'l1')).toEqual(l1Before)
    expect(itemsOf(qc, 'l2')).toEqual(l2Before)
    // No toast configured for single-item mutations.
    expect(showToast).not.toHaveBeenCalled()
  })

  it('onSettled invalidates the gear cache and exactly the touched lists', () => {
    const { qc } = seed()
    const invalidate = vi.spyOn(qc, 'invalidateQueries')
    const { onMutate, onSettled } = makeOptimisticGearItemUpdate({ qc })

    const ctx = onMutate({ id: 'g1', patch: { name: 'Mid' } })
    onSettled(undefined, null, { id: 'g1', patch: { name: 'Mid' } }, ctx)

    const keys = invalidate.mock.calls.map((c) => c[0]?.queryKey)
    expect(keys).toContainEqual(queryKeys.gearItems())
    expect(keys).toContainEqual(queryKeys.listItems('l1'))
    expect(keys).toContainEqual(queryKeys.listItems('l2'))
    expect(keys).not.toContainEqual(queryKeys.listItems('l3'))
  })
})

describe('makeOptimisticGearItemDelete', () => {
  it('drops the gear row and its membership rows in every affected list', () => {
    const { qc } = seed()
    const { onMutate } = makeOptimisticGearItemDelete({ qc })

    onMutate('g1')

    expect(gearCache(qc).map((g) => g.id)).toEqual(['g2', 'g3'])
    expect(itemsOf(qc, 'l1').map((i) => i.gearItemId)).toEqual(['g2'])
    expect(itemsOf(qc, 'l2')).toEqual([])
    expect(itemsOf(qc, 'l3')).toHaveLength(1)
  })

  it('onError restores dropped membership rows', () => {
    const { qc } = seed()
    const l2Before = itemsOf(qc, 'l2')
    const { onMutate, onError } = makeOptimisticGearItemDelete({ qc })

    const ctx = onMutate('g1')
    onError(new Error('nope'), 'g1', ctx)

    expect(itemsOf(qc, 'l2')).toEqual(l2Before)
  })
})

describe('makeOptimisticGearItemsBulkDelete', () => {
  it('drops every selected id across gear and list caches', () => {
    const { qc } = seed()
    const { onMutate } = makeOptimisticGearItemsBulkDelete({ qc })

    onMutate(['g1', 'g2'])

    expect(gearCache(qc).map((g) => g.id)).toEqual(['g3'])
    expect(itemsOf(qc, 'l1')).toEqual([])
    expect(itemsOf(qc, 'l2')).toEqual([])
    expect(itemsOf(qc, 'l3')).toHaveLength(1)
  })

  it('shows the configured toast on rollback', () => {
    const { qc } = seed()
    const { onMutate, onError } = makeOptimisticGearItemsBulkDelete({
      qc,
      errorToast: 'Bulk delete failed.',
    })

    const ctx = onMutate(['g1'])
    onError(new Error('nope'), ['g1'], ctx)

    expect(showToast).toHaveBeenCalledWith('Bulk delete failed.', {
      type: 'error',
    })
    // And the caches are back.
    expect(gearCache(qc).map((g) => g.id)).toEqual(['g1', 'g2', 'g3'])
    expect(itemsOf(qc, 'l2')).toHaveLength(1)
  })
})

describe('makeOptimisticGearItemsBulkCategoryMove', () => {
  it('recategorizes the gear rows and their embedded copies', () => {
    const { qc } = seed()
    const { onMutate } = makeOptimisticGearItemsBulkCategoryMove({ qc })

    onMutate({ ids: ['g1', 'g2'], categoryId: 'c9' })

    expect(gearCache(qc).filter((g) => g.categoryId === 'c9').map((g) => g.id))
      .toEqual(['g1', 'g2'])
    expect(itemsOf(qc, 'l1').every((i) => i.gearItem.categoryId === 'c9'))
      .toBe(true)
    expect(itemsOf(qc, 'l2')[0]?.gearItem.categoryId).toBe('c9')
    expect(itemsOf(qc, 'l3')[0]?.gearItem.categoryId).toBe('c1')
  })

  it('null recategorization (uncategorize) fans out too', () => {
    const { qc } = seed()
    const { onMutate } = makeOptimisticGearItemsBulkCategoryMove({ qc })

    onMutate({ ids: ['g1'], categoryId: null })

    expect(gearCache(qc).find((g) => g.id === 'g1')?.categoryId).toBeNull()
    expect(itemsOf(qc, 'l2')[0]?.gearItem.categoryId).toBeNull()
    // Membership fields (quantity, flags) are not the mutation's business.
    expect(itemsOf(qc, 'l2')[0]?.quantity).toBe(2)
  })
})
