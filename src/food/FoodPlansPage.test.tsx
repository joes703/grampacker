// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, cleanup, screen, fireEvent } from '@testing-library/react'

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
import { MemoryRouter } from 'react-router'
import type { ReactNode } from 'react'
import type { FoodPlanSummary } from '../lib/queries'
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
  fetchFoodPlans: vi.fn<() => Promise<FoodPlanSummary[]>>(),
}))
vi.mock('../lib/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/queries')>()
  return { ...actual, fetchFoodPlans: h.fetchFoodPlans }
})
const actionMocks = vi.hoisted(() => ({
  duplicateMutate: vi.fn(),
  removeMutate: vi.fn(),
  duplicatePending: false,
}))
vi.mock('./use-food-plan-actions', () => ({
  useFoodPlanActions: () => ({
    createPlan: { mutate: vi.fn(), isPending: false, error: null },
    duplicatePlan: {
      mutate: actionMocks.duplicateMutate,
      isPending: actionMocks.duplicatePending,
      error: null,
    },
    removePlan: { mutate: actionMocks.removeMutate, isPending: false, error: null },
  }),
}))

beforeEach(() => {
  actionMocks.duplicatePending = false
})

import FoodPlansPage from './FoodPlansPage'

afterEach(cleanup)

function summary(over: Partial<FoodPlanSummary> = {}): FoodPlanSummary {
  return {
    id: crypto.randomUUID(),
    name: 'JMT resupply',
    sortOrder: 0,
    dayCount: 3,
    entryCount: 12,
    usedByListId: null,
    usedByListName: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...over,
  }
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/food/plans']}>
        <MobilePrimaryNavProvider>{children}</MobilePrimaryNavProvider>
      </MemoryRouter>
    </QueryClientProvider>
  )
  return render(<FoodPlansPage />, { wrapper })
}

describe('FoodPlansPage', () => {
  it('renders one Plans route heading', async () => {
    h.fetchFoodPlans.mockResolvedValue([summary()])
    renderPage()

    expect(await screen.findByRole('heading', { level: 1, name: 'Plans' })).toBeTruthy()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  })

  it('renders the empty state when there are no plans', async () => {
    h.fetchFoodPlans.mockResolvedValue([])
    renderPage()
    expect(await screen.findByText('No plans yet')).toBeTruthy()
  })

  it('lists plans with their day and item counts', async () => {
    h.fetchFoodPlans.mockResolvedValue([
      summary({ name: 'JMT resupply', dayCount: 5, entryCount: 20 }),
      summary({ name: 'Weekender', dayCount: 1, entryCount: 1 }),
    ])
    renderPage()
    expect(await screen.findByText('JMT resupply')).toBeTruthy()
    expect(screen.getByText('2 plans')).toBeTruthy()
    // Singular vs plural for a one-day, one-item plan.
    expect(screen.getByText('1 day · 1 item')).toBeTruthy()
    expect(screen.getByText('5 days · 20 items')).toBeTruthy()
  })

  // One plan per trip: the card says which trip holds the plan, and Duplicate
  // is the index's reuse primitive ("want another plan? create new or
  // duplicate").
  it('shows which list a plan is in use by', async () => {
    h.fetchFoodPlans.mockResolvedValue([
      summary({
        name: 'Weekender',
        dayCount: 2,
        entryCount: 4,
        usedByListId: 'l-1',
        usedByListName: 'Yosemite trip',
      }),
    ])
    renderPage()
    expect(
      await screen.findByText('2 days · 4 items · In use by Yosemite trip'),
    ).toBeTruthy()
  })

  it('opens a plan from the row and keeps secondary actions in a touch-safe menu', async () => {
    const plan = summary({ name: 'Weekender' })
    h.fetchFoodPlans.mockResolvedValue([plan])
    renderPage()

    expect(await screen.findByRole('link', { name: /Weekender/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Duplicate plan' })).toBeNull()

    const options = screen.getByRole('button', { name: 'Weekender options' })
    expect(options.className).toContain('h-10 w-10 lg:h-7 lg:w-7')
    fireEvent.click(options)
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate plan' }))

    expect(actionMocks.duplicateMutate).toHaveBeenCalledWith(plan.id)
    expect(screen.queryByRole('button', { name: 'Duplicate plan' })).toBeNull()
  })

  it('preserves the destructive confirmation behind the plan menu', async () => {
    const plan = summary({ name: 'Weekender' })
    h.fetchFoodPlans.mockResolvedValue([plan])
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: 'Weekender options' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete plan' }))

    expect(screen.getByText(/This will delete "Weekender" and everything in it/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(actionMocks.removeMutate).toHaveBeenCalledWith(plan.id)
  })

  it('does not autofocus Delete when Duplicate is temporarily disabled', async () => {
    actionMocks.duplicatePending = true
    h.fetchFoodPlans.mockResolvedValue([
      summary({ name: 'First plan' }),
      summary({ name: 'Second plan' }),
    ])
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: 'Second plan options' }))

    const menu = screen.getByRole('group', { name: 'Second plan actions' })
    expect(menu).toHaveFocus()
    expect(screen.getByRole('button', { name: 'Delete plan' })).not.toHaveFocus()
  })

  it('opens the create dialog from a New plan control', async () => {
    h.fetchFoodPlans.mockResolvedValue([])
    renderPage()
    await screen.findByText('No plans yet')
    // Several "New plan" controls exist (header, empty state, mobile bar); any
    // opens the dialog. jsdom applies no CSS, so all are in the tree.
    const cta = screen.getAllByRole('button', { name: 'New plan' })[0]!
    fireEvent.click(cta)
    expect(screen.getByLabelText('Days')).toBeTruthy()
  })
})
