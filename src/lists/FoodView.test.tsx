// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, cleanup, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ListFoodResponse } from '../../shared/food'

// FoodView owns the food query's own three-state gate (AGENTS.md), separate
// from ListDetailPage's detail-data composite. This file pins that gate in
// isolation - ListDetailPage.food.test.tsx pins where FoodView is mounted
// and that a sibling detail-query failure does not reach it.

const h = vi.hoisted(() => ({ fetchListFood: vi.fn() }))

vi.mock('../lib/queries/food', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/queries/food')>()
  return { ...actual, fetchListFood: h.fetchListFood }
})

const listId = 'list-1'

const food: ListFoodResponse = {
  dayCount: 3,
  slots: [{ id: 'slot-1', dayNumber: 1, meal: 'breakfast', needed: true }],
  items: [],
} as unknown as ListFoodResponse

function renderFoodView() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return import('./FoodView').then(({ default: FoodView }) =>
    render(
      <QueryClientProvider client={qc}>
        <FoodView listId={listId} />
      </QueryClientProvider>,
    ),
  )
}

beforeEach(() => {
  h.fetchListFood.mockResolvedValue(food)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('FoodView query gate', () => {
  it('shows a loading state before live controls', async () => {
    let release: (value: ListFoodResponse) => void = () => {}
    h.fetchListFood.mockReturnValue(
      new Promise<ListFoodResponse>((resolve) => {
        release = resolve
      }),
    )

    await renderFoodView()
    expect(await screen.findByText('Loading food…')).toBeTruthy()
    expect(screen.queryByLabelText('Trip length in days')).not.toBeInTheDocument()

    release(food)
    expect(await screen.findByLabelText('Trip length in days')).toBeInTheDocument()
  })

  it('shows retry, not live controls, when the food read fails', async () => {
    h.fetchListFood.mockRejectedValue(new Error('offline'))

    await renderFoodView()
    expect(await screen.findByText("Couldn't load the food plan.")).toBeInTheDocument()
    expect(screen.queryByLabelText('Trip length in days')).not.toBeInTheDocument()
  })

  it('renders live controls once the food read resolves', async () => {
    await renderFoodView()
    const days = await screen.findByLabelText('Trip length in days')
    expect((days as HTMLInputElement).disabled).toBe(false)
    expect((days as HTMLInputElement).value).toBe('3')
  })
})
