// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { FoodItem, FoodPlanDocument as Doc, FoodPlanEntry } from '../lib/types'

// The entry mutations were inline in FoodPlanDocument (only covered indirectly by
// the FoodPlanPage integration tests). This locks the logic the extraction
// exposed: the add cap counts only NEW targets, merge into an occupied target
// reuses its sort_order and skips the cap, move passes the source id while copy
// passes null, copy into an empty target charges the cap while copy onto the same
// food does not, and every mutation settles through `invalidate`.
//
// The mocks are typed via vi.fn<FnType>() (a function-type annotation, so no
// unused-param bindings) which makes `.mock.calls[i]` a typed tuple. An untyped
// `() => ...` impl makes the call args an empty tuple, which tsc -b then refuses
// to read - the failure npm run build catches but vitest's transpile does not.
type EntryAdditionArg = { entry: Record<string, unknown>; preserve_basis: unknown }

const h = vi.hoisted(() => ({
  upsertFoodPlanEntry: vi.fn<(userId: string, addition: Record<string, unknown>, preserveBasis: unknown, moveSourceId: unknown) => Promise<unknown>>(),
  upsertFoodPlanEntries: vi.fn<(userId: string, additions: { entry: Record<string, unknown>; preserve_basis: unknown }[]) => Promise<unknown>>(),
  updateFoodPlanEntry: vi.fn<(id: string, patch: unknown) => Promise<void>>(),
  deleteFoodPlanEntry: vi.fn<(id: string) => Promise<void>>(),
  // F9: the entry-add cap now routes through assertFoodPlanEntriesWithinCap,
  // which owns the "existing + addCount - 1" arithmetic and the add-nothing
  // no-op. These tests assert the hook reports the right (existingCount,
  // addCount); the threshold/no-op behavior is covered in food-plan.test.ts.
  assertFoodPlanEntriesWithinCap: vi.fn<(existingCount: number, addCount: number) => void>(),
}))

vi.mock('../lib/queries', () => h)
// Deterministic temp id so the additions are exact-matchable.
vi.mock('../lib/random-temp-id', () => ({ randomTempId: () => 'tmp-id' }))

import { useFoodPlanEntryActions } from './use-food-plan-entry-actions'

const NOW = '2026-01-01T00:00:00.000Z'

// The hook reads only `food.id`; the rest of FoodItem is irrelevant here.
const food = { id: 'f1' } as FoodItem

function entry(over: Partial<FoodPlanEntry> & { id: string }): FoodPlanEntry {
  return {
    user_id: 'u1', food_plan_id: 'p1', day_meal_id: 'dm-b', is_extra: false,
    food_item_id: 'f1', basis: 'servings', amount: 1, sort_order: 0,
    created_at: NOW, updated_at: NOW, ...over,
  }
}

function doc(entries: FoodPlanEntry[]): Doc {
  return {
    plan: { id: 'p1', user_id: 'u1', list_id: 'l1', is_food_shared: false, created_at: NOW, updated_at: NOW },
    meals: [], days: [], dayMeals: [], entries, dailyTargets: [], mealTargets: [],
  }
}

function setup(currentDoc: Doc) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  const invalidate = vi.fn()
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
  const { result } = renderHook(
    () => useFoodPlanEntryActions('u1', currentDoc, invalidate),
    { wrapper },
  )
  return { result, invalidate }
}

// `.mock.calls[0]` is `Tuple | undefined` under noUncheckedIndexedAccess; the
// preceding waitFor proves the call happened, so a non-null assert is honest.
function firstAddBatch(): EntryAdditionArg[] {
  const [, additions] = h.upsertFoodPlanEntries.mock.calls[0]!
  return additions
}

afterEach(() => vi.clearAllMocks())

describe('useFoodPlanEntryActions', () => {
  describe('addMut', () => {
    it('charges the cap for a fresh add and upserts one addition (preserve null)', async () => {
      // Doc already holds two unrelated entries in a DIFFERENT cell; adding one
      // NEW food into the empty dm-b cell, which appends at sort_order 0.
      const existing = [
        entry({ id: 'e1', food_item_id: 'other', day_meal_id: 'dm-x', sort_order: 3 }),
        entry({ id: 'e2', food_item_id: 'other2', day_meal_id: 'dm-x', sort_order: 4 }),
      ]
      const { result, invalidate } = setup(doc(existing))

      result.current.addMut.mutate({
        food,
        target: { kind: 'cell', dayMealId: 'dm-b' },
        result: { basis: 'servings', amount: 2, preserveBasis: null, alsoDayMealIds: [] },
      })

      await waitFor(() => expect(h.upsertFoodPlanEntries).toHaveBeenCalled())
      const [uid] = h.upsertFoodPlanEntries.mock.calls[0]!
      const additions = firstAddBatch()
      expect(uid).toBe('u1')
      expect(additions).toHaveLength(1)
      expect(additions[0]!.entry).toMatchObject({
        id: 'tmp-id', food_plan_id: 'p1', day_meal_id: 'dm-b', is_extra: false,
        food_item_id: 'f1', basis: 'servings', amount: 2, sort_order: 0,
      })
      expect(additions[0]!.preserve_basis).toBeNull()
      // adds 1 new entry to a plan with 2 existing entries.
      expect(h.assertFoodPlanEntriesWithinCap).toHaveBeenCalledWith(2, 1)
      await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(1))
    })

    it('merges into an occupied target: no cap, reuses its sort_order, passes preserveBasis', async () => {
      const existing = entry({ id: 'e1', food_item_id: 'f1', day_meal_id: 'dm-b', sort_order: 7 })
      const { result } = setup(doc([existing]))

      result.current.addMut.mutate({
        food,
        target: { kind: 'cell', dayMealId: 'dm-b' },
        result: { basis: 'weight', amount: 60, preserveBasis: 'servings', alsoDayMealIds: [] },
      })

      await waitFor(() => expect(h.upsertFoodPlanEntries).toHaveBeenCalled())
      const additions = firstAddBatch()
      expect(additions[0]!.entry.sort_order).toBe(7)
      expect(additions[0]!.preserve_basis).toBe('servings')
      // newCount is 0 (the only target already holds the food): the hook reports
      // addCount 0, which the helper treats as a no-op (no cap charge).
      expect(h.assertFoodPlanEntriesWithinCap).toHaveBeenCalledWith(1, 0)
    })

    it('multi-day add fans out to each also-day and charges the cap once for the new count', async () => {
      const { result } = setup(doc([]))

      result.current.addMut.mutate({
        food,
        target: { kind: 'cell', dayMealId: 'dm-b1' },
        result: { basis: 'servings', amount: 1, preserveBasis: null, alsoDayMealIds: ['dm-b2'] },
      })

      await waitFor(() => expect(h.upsertFoodPlanEntries).toHaveBeenCalled())
      const additions = firstAddBatch()
      expect(additions.map((a) => a.entry.day_meal_id)).toEqual(['dm-b1', 'dm-b2'])
      // adds 2 new entries (both also-days) to an empty plan.
      expect(h.assertFoodPlanEntriesWithinCap).toHaveBeenCalledWith(0, 2)
    })

    it('throws before upserting when the add would exceed the cap', async () => {
      h.assertFoodPlanEntriesWithinCap.mockImplementationOnce(() => { throw new Error('cap') })
      const { result } = setup(doc([]))

      result.current.addMut.mutate({
        food,
        target: { kind: 'cell', dayMealId: 'dm-b' },
        result: { basis: 'servings', amount: 1, preserveBasis: null, alsoDayMealIds: [] },
      })

      await waitFor(() => expect(result.current.addMut.isError).toBe(true))
      expect(h.upsertFoodPlanEntries).not.toHaveBeenCalled()
    })
  })

  describe('editMut', () => {
    it('updates basis + amount by id and invalidates', async () => {
      const { result, invalidate } = setup(doc([entry({ id: 'e1' })]))

      result.current.editMut.mutate({ id: 'e1', basis: 'weight', amount: 50 })

      await waitFor(() => expect(h.updateFoodPlanEntry).toHaveBeenCalledWith('e1', { basis: 'weight', amount: 50 }))
      await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(1))
    })
  })

  describe('removeMut', () => {
    it('deletes by id and invalidates', async () => {
      const { result, invalidate } = setup(doc([entry({ id: 'e1' })]))

      result.current.removeMut.mutate('e1')

      await waitFor(() => expect(h.deleteFoodPlanEntry).toHaveBeenCalledWith('e1'))
      await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(1))
    })
  })

  describe('moveCopyMut', () => {
    it('move passes the source id, skips the cap, and targets the destination', async () => {
      const e = entry({ id: 'e1', food_item_id: 'f1', basis: 'weight', amount: 50, day_meal_id: 'dm-b' })
      const { result, invalidate } = setup(doc([e]))

      result.current.moveCopyMut.mutate({ entry: e, target: { kind: 'extra' }, preserveBasis: null, isMove: true })

      await waitFor(() => expect(h.upsertFoodPlanEntry).toHaveBeenCalled())
      const [uid, addition, preserve, moveSrc] = h.upsertFoodPlanEntry.mock.calls[0]!
      expect(uid).toBe('u1')
      expect(addition).toMatchObject({ is_extra: true, day_meal_id: null, food_item_id: 'f1', basis: 'weight', amount: 50 })
      expect(preserve).toBeNull()
      expect(moveSrc).toBe('e1')
      // a move adds nothing: the hook reports addCount 0.
      expect(h.assertFoodPlanEntriesWithinCap).toHaveBeenCalledWith(1, 0)
      await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(1))
    })

    it('copy into an empty target charges the cap and passes a null source id', async () => {
      const e = entry({ id: 'e1', food_item_id: 'f1', day_meal_id: 'dm-b' })
      const { result } = setup(doc([e]))

      result.current.moveCopyMut.mutate({ entry: e, target: { kind: 'cell', dayMealId: 'dm-l' }, preserveBasis: 'servings', isMove: false })

      await waitFor(() => expect(h.upsertFoodPlanEntry).toHaveBeenCalled())
      const [, addition, preserve, moveSrc] = h.upsertFoodPlanEntry.mock.calls[0]!
      expect(addition).toMatchObject({ day_meal_id: 'dm-l', is_extra: false, food_item_id: 'f1' })
      expect(preserve).toBe('servings')
      expect(moveSrc).toBeNull()
      // copy into a cell that does not already hold the food adds 1 entry.
      expect(h.assertFoodPlanEntriesWithinCap).toHaveBeenCalledWith(1, 1)
    })

    it('copy onto a target that already holds the food skips the cap', async () => {
      const e = entry({ id: 'e1', food_item_id: 'f1', day_meal_id: 'dm-b' })
      const dupTarget = entry({ id: 'e2', food_item_id: 'f1', day_meal_id: 'dm-l' })
      const { result } = setup(doc([e, dupTarget]))

      result.current.moveCopyMut.mutate({ entry: e, target: { kind: 'cell', dayMealId: 'dm-l' }, preserveBasis: 'servings', isMove: false })

      await waitFor(() => expect(h.upsertFoodPlanEntry).toHaveBeenCalled())
      // copy onto an occupied target merges: the hook reports addCount 0.
      expect(h.assertFoodPlanEntriesWithinCap).toHaveBeenCalledWith(2, 0)
    })
  })

  describe('existingEntry', () => {
    it('finds the food in a cell target and reports absence elsewhere', () => {
      const e = entry({ id: 'e1', food_item_id: 'f1', day_meal_id: 'dm-b', is_extra: false })
      const { result } = setup(doc([e]))

      expect(result.current.existingEntry(food, { kind: 'cell', dayMealId: 'dm-b' })).toBe(e)
      expect(result.current.existingEntry(food, { kind: 'cell', dayMealId: 'dm-l' })).toBeUndefined()
      expect(result.current.existingEntry(food, { kind: 'extra' })).toBeUndefined()
    })
  })
})
