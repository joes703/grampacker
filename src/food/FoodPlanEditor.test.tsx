// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, cleanup, screen, fireEvent, within } from '@testing-library/react'

// <dialog>.showModal/close are not implemented in jsdom; Modal.tsx calls them.
beforeAll(() => {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function () {
      this.open = true
    }
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function () {
      this.open = false
    }
  }
})
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router'
import type { ReactNode } from 'react'
import type { FoodItem, FoodPlanDocument } from '../lib/queries'
import { MobilePrimaryNavProvider } from '../layout/mobile-primary-nav-context'

function stubViewport() {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }))
}
beforeEach(stubViewport)

const h = vi.hoisted(() => ({
  fetchFoodPlan: vi.fn<(id: string) => Promise<FoodPlanDocument>>(),
  fetchFoodItems: vi.fn<() => Promise<FoodItem[]>>(),
}))
vi.mock('../lib/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/queries')>()
  return {
    ...actual,
    fetchFoodPlan: h.fetchFoodPlan,
    fetchFoodItems: h.fetchFoodItems,
  }
})
// Action hook is mocked: this test exercises rendering + projection + the
// busy-gate, not real writes. `pending` lets a test mark one mutation in flight.
const state = vi.hoisted(() => ({ pending: null as string | null }))
vi.mock('./use-food-plan-editor-actions', () => ({
  useFoodPlanEditorActions: () => {
    const make = (key: string) => ({
      mutate: vi.fn(),
      mutateAsync: vi.fn().mockResolvedValue(undefined),
      isPending: state.pending === key,
      error: null,
    })
    return {
      rename: make('rename'),
      addDay: make('addDay'),
      removeDay: make('removeDay'),
      addMeal: make('addMeal'),
      removeMeal: make('removeMeal'),
      addEntry: make('addEntry'),
      updateEntry: make('updateEntry'),
      removeEntry: make('removeEntry'),
    }
  },
}))

import FoodPlanEditor from './FoodPlanEditor'

afterEach(() => {
  cleanup()
  state.pending = null
})

function food(id: string, over: Partial<FoodItem> = {}): FoodItem {
  return {
    id,
    name: 'Ramen',
    brand: null,
    servingDescription: null,
    servingWeightGrams: 50,
    caloriesPerServing: 200,
    servingsPerPackage: null,
    fatGrams: null,
    saturatedFatGrams: null,
    carbsGrams: null,
    fiberGrams: null,
    sugarGrams: null,
    proteinGrams: null,
    sodiumMg: null,
    potassiumMg: null,
    notes: null,
    sortOrder: 0,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...over,
  }
}

function planDoc(over: Partial<FoodPlanDocument> = {}): FoodPlanDocument {
  return {
    id: 'plan1',
    name: 'JMT resupply',
    sortOrder: 0,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    meals: [
      { id: 'm-bfast', name: 'Breakfast', anchorRole: 'breakfast', isDefault: true, sortOrder: 0 },
      { id: 'm-dinner', name: 'Dinner', anchorRole: 'dinner', isDefault: true, sortOrder: 1 },
    ],
    days: [{ id: 'd1', dayTypeOverride: null, sortOrder: 0 }],
    dayMeals: [
      { id: 'c-bfast', dayId: 'd1', mealId: 'm-bfast' },
      { id: 'c-dinner', dayId: 'd1', mealId: 'm-dinner' },
    ],
    entries: [
      // 2 servings of a 50 g food = 100 g in Day 1 breakfast.
      { id: 'e1', dayMealId: 'c-bfast', isExtra: false, foodItemId: 'f1', basis: 'servings', amount: 2, sortOrder: 0 },
    ],
    dailyTargets: [],
    mealTargets: [],
    usedByList: null,
    ...over,
  }
}

function renderEditor(initialEntry = '/food/plans/plan1') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <MobilePrimaryNavProvider>{children}</MobilePrimaryNavProvider>
      </MemoryRouter>
    </QueryClientProvider>
  )
  return render(
    <Routes>
      <Route path="/food/plans/:id" element={<FoodPlanEditor />} />
    </Routes>,
    { wrapper },
  )
}

describe('FoodPlanEditor', () => {
  it('renders the plan, its meals, and the projected day/cell weights', async () => {
    h.fetchFoodPlan.mockResolvedValue(planDoc())
    h.fetchFoodItems.mockResolvedValue([food('f1')])
    renderEditor()

    expect(await screen.findByText('JMT resupply')).toBeTruthy()
    // The Breakfast cell and its Day 1 both project to 100 g.
    expect(screen.getByText('Day 1')).toBeTruthy()
    expect(screen.getByText('Ramen')).toBeTruthy()
    expect(screen.getByText('2 servings')).toBeTruthy()
    // Both default meals appear (as a pill in the meal bar and as a cell
    // heading within the day).
    expect(screen.getAllByText('Breakfast').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Dinner').length).toBeGreaterThan(0)
    // The whole-plan food weight is shown.
    expect(screen.getByText('food weight')).toBeTruthy()
  })

  it('flags an incomplete plan (packages entry with no package size)', async () => {
    const doc = planDoc()
    doc.entries = [
      { id: 'e1', dayMealId: 'c-bfast', isExtra: false, foodItemId: 'f1', basis: 'packages', amount: 1, sortOrder: 0 },
    ]
    h.fetchFoodPlan.mockResolvedValue(doc)
    h.fetchFoodItems.mockResolvedValue([food('f1', { servingsPerPackage: null })])
    renderEditor()

    await screen.findByText('JMT resupply')
    // The plan-level estimate badge appears.
    expect(screen.getByText('Estimate')).toBeTruthy()
  })

  it('opens the add-food dialog scoped to the chosen cell', async () => {
    h.fetchFoodPlan.mockResolvedValue(planDoc())
    h.fetchFoodItems.mockResolvedValue([food('f1', { name: 'Oatmeal' })])
    renderEditor()

    await screen.findByText('JMT resupply')
    // Two "Add food" buttons (breakfast, dinner) + Extras; click the first.
    const addButtons = screen.getAllByRole('button', { name: 'Add food' })
    fireEvent.click(addButtons[0]!)
    const dialog = await screen.findByRole('dialog', {
      name: 'Add food to Day 1 · Breakfast',
    })
    expect(within(dialog).getByPlaceholderText('Search your food library')).toBeTruthy()
  })

  it('disables every write trigger while a mutation is pending (serialization)', async () => {
    state.pending = 'addDay'
    h.fetchFoodPlan.mockResolvedValue(planDoc())
    h.fetchFoodItems.mockResolvedValue([food('f1')])
    renderEditor()

    await screen.findByText('JMT resupply')
    // The always-visible background triggers must all be disabled so a second
    // mutation can't start and clobber the in-flight one's returned document.
    expect(
      (screen.getByRole('button', { name: 'Adding day…' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)
    for (const btn of screen.getAllByRole('button', { name: 'Add food' })) {
      expect((btn as HTMLButtonElement).disabled).toBe(true)
    }
    expect(
      (screen.getByRole('button', { name: 'Rename plan' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)
  })

  it('shows a not-found message when the plan is missing', async () => {
    const { ApiError } = await import('../lib/api')
    h.fetchFoodPlan.mockRejectedValue(new ApiError(404, 'Not found'))
    h.fetchFoodItems.mockResolvedValue([])
    renderEditor()

    expect(
      await screen.findByText(/this plan doesn't exist/i),
    ).toBeTruthy()
  })

  // One plan per trip: at most one list references this plan, and the editor
  // says which with a quiet breadcrumb (the pre-2026-07-16 shared-plan
  // warning is gone with the many-lists model that made it necessary).
  describe('used-by breadcrumb', () => {
    it('stays quiet for a plan backing no list', async () => {
      h.fetchFoodPlan.mockResolvedValue(planDoc({ usedByList: null }))
      h.fetchFoodItems.mockResolvedValue([food('f1')])
      renderEditor()

      await screen.findByText('JMT resupply')
      expect(screen.queryByText(/used by/i)).toBeNull()
    })

    it('links the trip that uses this plan', async () => {
      h.fetchFoodPlan.mockResolvedValue(
        planDoc({ usedByList: { id: 'list-a', name: 'JMT 2026' } }),
      )
      h.fetchFoodItems.mockResolvedValue([food('f1')])
      renderEditor()

      expect(await screen.findByText(/used by/i)).toBeTruthy()
      expect(
        screen.getByRole('link', { name: 'JMT 2026' }).getAttribute('href'),
      ).toBe('/lists/list-a')
    })
  })
})
