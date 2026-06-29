// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { FoodPlanDocument as Doc, Meal } from '../lib/types'

// The meal/schedule mutations were inline in FoodPlanDocument (no dedicated test;
// only the queries were mocked at the page level). This locks the logic the
// extraction exposed: add-meal charges the meal cap and appends at
// max(sort_order)+1, omit/restore/delete map to the right query, and the schedule
// toggle routes on=true to addDayMeal and on=false to deleteDayMeal (with the
// `?? ''` fallback when no day_meal exists yet). Every mutation invalidates.
//
// Mocks are typed via vi.fn<FnType>() so `.mock.calls[i]` is a typed tuple under
// tsc -b (an untyped impl yields an empty tuple that npm run build rejects).
const h = vi.hoisted(() => ({
  addMealDefinition: vi.fn<(userId: string, foodPlanId: string, name: string, sortOrder: number) => Promise<void>>(),
  deleteMeal: vi.fn<(id: string) => Promise<void>>(),
  deleteDayMeal: vi.fn<(id: string) => Promise<void>>(),
  addDayMeal: vi.fn<(userId: string, foodPlanId: string, dayId: string, mealId: string) => Promise<unknown>>(),
  assertMealDefinitionWithinCap: vi.fn<(existingMeals: number) => void>(),
}))

vi.mock('../lib/queries', () => h)

import { useFoodPlanMealActions } from './use-food-plan-meal-actions'

const NOW = '2026-01-01T00:00:00.000Z'

function meal(over: Partial<Meal> & { id: string }): Meal {
  return {
    user_id: 'u1', food_plan_id: 'p1', name: 'Meal', anchor_role: null,
    is_default: false, sort_order: 0, created_at: NOW, updated_at: NOW, ...over,
  }
}

function doc(meals: Meal[]): Doc {
  return {
    plan: { id: 'p1', user_id: 'u1', list_id: 'l1', is_food_shared: false, created_at: NOW, updated_at: NOW },
    meals, days: [], dayMeals: [], entries: [], dailyTargets: [], mealTargets: [],
  }
}

function setup(currentDoc: Doc) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  const invalidate = vi.fn()
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
  const { result } = renderHook(
    () => useFoodPlanMealActions('u1', currentDoc, invalidate),
    { wrapper },
  )
  return { result, invalidate }
}

afterEach(() => vi.clearAllMocks())

describe('useFoodPlanMealActions', () => {
  describe('addMealMut', () => {
    it('charges the meal cap, appends at max(sort_order)+1, and invalidates', async () => {
      const meals = [meal({ id: 'm1', sort_order: 0 }), meal({ id: 'm2', sort_order: 4 })]
      const { result, invalidate } = setup(doc(meals))

      result.current.addMealMut.mutate('Lunch')

      await waitFor(() => expect(h.addMealDefinition).toHaveBeenCalledWith('u1', 'p1', 'Lunch', 5))
      expect(h.assertMealDefinitionWithinCap).toHaveBeenCalledWith(2)
      await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(1))
    })

    it('throws before addMealDefinition when at the meal cap', async () => {
      h.assertMealDefinitionWithinCap.mockImplementationOnce(() => { throw new Error('cap') })
      const { result } = setup(doc([]))

      result.current.addMealMut.mutate('Lunch')

      await waitFor(() => expect(result.current.addMealMut.isError).toBe(true))
      expect(h.addMealDefinition).not.toHaveBeenCalled()
    })
  })

  describe('omitMealMut', () => {
    it('deletes the day_meal by id and invalidates', async () => {
      const { result, invalidate } = setup(doc([]))

      result.current.omitMealMut.mutate('dm-1')

      await waitFor(() => expect(h.deleteDayMeal).toHaveBeenCalledWith('dm-1'))
      await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(1))
    })
  })

  describe('restoreMealMut', () => {
    it('adds the day_meal for the day + meal and invalidates', async () => {
      const { result, invalidate } = setup(doc([]))

      result.current.restoreMealMut.mutate({ dayId: 'd1', mealId: 'm1' })

      await waitFor(() => expect(h.addDayMeal).toHaveBeenCalledWith('u1', 'p1', 'd1', 'm1'))
      await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(1))
    })
  })

  describe('deleteMealMut', () => {
    it('deletes the meal definition by id and invalidates', async () => {
      const { result, invalidate } = setup(doc([]))

      result.current.deleteMealMut.mutate('m1')

      await waitFor(() => expect(h.deleteMeal).toHaveBeenCalledWith('m1'))
      await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(1))
    })
  })

  describe('toggleCellMut', () => {
    it('on=true adds the day_meal and invalidates', async () => {
      const { result, invalidate } = setup(doc([]))

      result.current.toggleCellMut.mutate({ dayId: 'd1', mealId: 'm1', on: true })

      await waitFor(() => expect(h.addDayMeal).toHaveBeenCalledWith('u1', 'p1', 'd1', 'm1'))
      expect(h.deleteDayMeal).not.toHaveBeenCalled()
      await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(1))
    })

    it('on=false deletes the existing day_meal and invalidates', async () => {
      const { result, invalidate } = setup(doc([]))

      result.current.toggleCellMut.mutate({ dayId: 'd1', mealId: 'm1', on: false, dayMealId: 'dm-1' })

      await waitFor(() => expect(h.deleteDayMeal).toHaveBeenCalledWith('dm-1'))
      expect(h.addDayMeal).not.toHaveBeenCalled()
      await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(1))
    })

    it('on=false with no day_meal falls back to deleteDayMeal("")', async () => {
      const { result } = setup(doc([]))

      result.current.toggleCellMut.mutate({ dayId: 'd1', mealId: 'm1', on: false })

      await waitFor(() => expect(h.deleteDayMeal).toHaveBeenCalledWith(''))
    })
  })
})
