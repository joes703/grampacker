// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import FoodPicker from './FoodPicker'
import type { FoodItem } from '../lib/types'

vi.mock('../lib/queries', () => ({
  assertFoodItemWithinCap: () => {},
  createFoodItem: vi.fn(),
  queryKeys: { foodItems: () => ['food-items'] as const },
  nextFoodItemSortOrder: () => 0,
}))

afterEach(cleanup)

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.open = true }
  HTMLDialogElement.prototype.close = function () { this.open = false }
})

function food(overrides: Partial<FoodItem> = {}): FoodItem {
  return {
    id: 'food-1',
    user_id: 'user-1',
    name: 'Energy bar',
    brand: 'Trail Co',
    serving_description: 'bar',
    serving_weight_grams: 60,
    calories_per_serving: 260,
    servings_per_package: null,
    fat_grams: null,
    saturated_fat_grams: null,
    carbs_grams: null,
    fiber_grams: null,
    sugar_grams: null,
    protein_grams: null,
    sodium_mg: null,
    potassium_mg: null,
    notes: null,
    sort_order: 0,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '',
    ...overrides,
  }
}

function renderPicker({
  foods = [],
  usedFoodIds = new Set<string>(),
}: {
  foods?: FoodItem[]
  usedFoodIds?: Set<string>
}) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={qc}>
      <FoodPicker
        foods={foods}
        usedFoodIds={usedFoodIds}
        userId="user-1"
        onPick={vi.fn()}
        onClose={vi.fn()}
      />
    </QueryClientProvider>,
  )
}

describe('FoodPicker', () => {
  it('shows calories and serving metadata for each row', () => {
    renderPicker({
      foods: [
        food({ id: 'food-1', name: 'Energy bar', serving_description: 'bar', serving_weight_grams: 60, calories_per_serving: 260 }),
        food({ id: 'food-2', name: 'Granola', brand: null, serving_description: null, serving_weight_grams: 80, calories_per_serving: 400 }),
      ],
    })

    expect(screen.getByText('260 kcal')).toBeInTheDocument()
    expect(screen.getByText('bar')).toBeInTheDocument()
    expect(screen.getByText('400 kcal')).toBeInTheDocument()
    expect(screen.getByText('80 g')).toBeInTheDocument()
  })

  it('shows In plan only for used foods in every tab', async () => {
    const user = userEvent.setup()
    renderPicker({
      foods: [
        food({ id: 'food-used', name: 'Used bars', created_at: '2026-01-02T00:00:00Z' }),
        food({ id: 'food-unused', name: 'Unused oats', created_at: '2026-01-01T00:00:00Z' }),
      ],
      usedFoodIds: new Set(['food-used']),
    })

    expect(within(screen.getByRole('button', { name: /Used bars/i })).getByText('In plan')).toBeInTheDocument()
    expect(within(screen.getByRole('button', { name: /Unused oats/i })).queryByText('In plan')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'A-Z' }))

    expect(within(screen.getByRole('button', { name: /Used bars/i })).getByText('In plan')).toBeInTheDocument()
  })

  it('changes the helper hint when switching tabs', async () => {
    const user = userEvent.setup()
    renderPicker({ foods: [food()] })

    expect(screen.getByText('Recently used across your trips')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'In this plan' }))
    expect(screen.getByText('Already in this plan')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'A-Z' }))
    expect(screen.getByText('All foods, alphabetical')).toBeInTheDocument()
  })
})
