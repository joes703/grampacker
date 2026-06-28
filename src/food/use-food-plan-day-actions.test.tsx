// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { FoodPlanDay, FoodPlanDocument as Doc, FoodPlanEntry, Meal } from '../lib/types'
import type { DayView, FoodPlanView } from './useFoodPlanDocument'

// The day mutations were inline in FoodPlanDocument (no component test), so this
// locks the logic the extraction exposed: append sort_order = max(sort)+1, the
// duplicate cap counts the source day's entries, and every mutation settles
// through `invalidate`.

const h = vi.hoisted(() => ({
  addFoodPlanDay: vi.fn(async () => ({})),
  deleteFoodPlanDay: vi.fn(async () => ({})),
  duplicateFoodPlanDay: vi.fn(async () => ({})),
  updateDayType: vi.fn(async () => ({})),
  assertFoodPlanDayWithinCap: vi.fn(),
  assertFoodPlanEntryWithinCap: vi.fn(),
}))

vi.mock('../lib/queries', () => h)

import { useFoodPlanDayActions } from './use-food-plan-day-actions'

const NOW = '2026-01-01T00:00:00.000Z'

function day(id: string, sortOrder: number): FoodPlanDay {
  return { id, user_id: 'u1', food_plan_id: 'p1', day_type_override: null, sort_order: sortOrder, created_at: NOW, updated_at: NOW }
}

function entry(id: string): FoodPlanEntry {
  return {
    id, user_id: 'u1', food_plan_id: 'p1', day_meal_id: 'dm1', is_extra: false,
    food_item_id: 'f1', basis: 'servings', amount: 1, sort_order: 0, created_at: NOW, updated_at: NOW,
  }
}

function doc(days: FoodPlanDay[], entries: FoodPlanEntry[] = []): Doc {
  return {
    plan: { id: 'p1', user_id: 'u1', list_id: 'l1', is_food_shared: false, created_at: NOW, updated_at: NOW },
    meals: [], days, dayMeals: [], entries, dailyTargets: [], mealTargets: [],
  }
}

const meal: Meal = { id: 'm1', user_id: 'u1', food_plan_id: 'p1', name: 'Breakfast', anchor_role: null, is_default: true, sort_order: 0, created_at: NOW, updated_at: NOW }

// A view whose day 'd1' carries two entries across its cells, for the
// duplicate source-entry-count path.
function view(days: FoodPlanDay[], cellEntries: FoodPlanEntry[]): FoodPlanView {
  const dayViews: DayView[] = days.map((d) => ({
    day: d,
    dayType: 'full',
    cells: [{ dayMealId: 'dm1', meal, entries: d.id === 'd1' ? cellEntries : [] }],
    scheduledMealIds: new Set(['m1']),
  }))
  return { meals: [meal], days: dayViews, extras: [] }
}

function setup(currentDoc: Doc, planView: FoodPlanView) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  const invalidate = vi.fn()
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
  const { result } = renderHook(
    () => useFoodPlanDayActions('u1', currentDoc, planView, invalidate),
    { wrapper },
  )
  return { result, invalidate }
}

afterEach(() => vi.clearAllMocks())

describe('useFoodPlanDayActions', () => {
  it('addDayMut appends with sort_order = max(existing) + 1 and invalidates', async () => {
    const days = [day('d1', 0), day('d2', 4)]
    const { result, invalidate } = setup(doc(days), view(days, []))

    result.current.addDayMut.mutate()

    await waitFor(() => expect(h.addFoodPlanDay).toHaveBeenCalledWith('u1', 'p1', 5))
    await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(1))
  })

  it('deleteDayMut deletes by id and invalidates', async () => {
    const days = [day('d1', 0)]
    const { result, invalidate } = setup(doc(days), view(days, []))

    result.current.deleteDayMut.mutate('d1')

    await waitFor(() => expect(h.deleteFoodPlanDay).toHaveBeenCalledWith('d1'))
    await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(1))
  })

  it('duplicateDayMut counts the source day entries for the cap and appends', async () => {
    const days = [day('d1', 0), day('d2', 1)]
    // Source day d1 has two entries; total entries in the doc is two.
    const entries = [entry('e1'), entry('e2')]
    const { result, invalidate } = setup(doc(days, entries), view(days, entries))

    result.current.duplicateDayMut.mutate('d1')

    await waitFor(() => expect(h.duplicateFoodPlanDay).toHaveBeenCalledWith('u1', 'd1', 2))
    // doc has 2 entries + 2 from the duplicated source - 1 = 3 (the cap helper's
    // "adding N more" contract, mirrored from the original inline closure).
    expect(h.assertFoodPlanEntryWithinCap).toHaveBeenCalledWith(3)
    await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(1))
  })

  it('dayTypeMut updates the override and invalidates', async () => {
    const days = [day('d1', 0)]
    const { result, invalidate } = setup(doc(days), view(days, []))

    result.current.dayTypeMut.mutate({ dayId: 'd1', override: 'partial' })

    await waitFor(() => expect(h.updateDayType).toHaveBeenCalledWith('d1', 'partial'))
    await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(1))
  })
})
