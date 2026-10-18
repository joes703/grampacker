// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import { useQuery } from '@tanstack/react-query'
import type { Category, GearItem, ListItemWithGear, PackingLocation } from '../lib/types'
import {
  fetchCategories,
  fetchGearItems,
  fetchListFood,
  fetchListItems,
  queryKeys,
} from '../lib/queries'
import {
  emptyFood,
  list,
  listId,
  renderListDetailPage,
  stubViewport,
} from './test/list-detail-harness'

// The List and Pack views read four collections behind one gate: list items,
// gear, categories and this list's food. Each one falls back to [] while it
// has no data, so a failed first load looks exactly like an empty list or
// 0 g of food. The page must show its error panel instead, and must not
// replace a page it has already rendered when only a background refetch
// fails (the query keeps its last data). See AGENTS.md "An empty array is
// not nothing".

const gear = {
  id: 'gear-1',
  name: 'Cooking pot',
  weightGrams: 210,
  categoryId: null,
} as unknown as GearItem

const listItem = {
  id: 'li-1',
  gearItemId: 'gear-1',
  gearItem: gear,
  quantity: 1,
  isWorn: false,
  isConsumable: false,
  isPacked: false,
  isReady: false,
  packingLocationId: null,
  sortOrder: 0,
  packSortOrder: 0,
} as unknown as ListItemWithGear

const h = vi.hoisted(() => ({
  fetchLists: vi.fn(),
  fetchListItems: vi.fn(),
  fetchGearItems: vi.fn(),
  fetchCategories: vi.fn(),
  fetchPackingLocations: vi.fn(),
  fetchListFood: vi.fn(),
}))

// Keeps better-auth's session atom from mounting (test/list-detail-harness.tsx
// explains why).
vi.mock('../lib/auth-client', () => ({
  authClient: { useSession: () => ({ data: { user: { id: 'owner-1' } }, isPending: false }) },
}))

vi.mock('../lib/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/queries')>()
  return { ...actual, ...h }
})

// The probe reads only the query's status, so one loose shape fits all four.
type ProbeOptions = { queryKey: readonly unknown[]; queryFn: () => Promise<unknown> }

// One row per collection behind the gate. `probe` observes the same query
// with the same fetcher the page uses, so a test can wait until a rendered
// observer has seen the error (see QueryProbe).
const sources: readonly {
  name: string
  fetcher: (typeof h)[keyof typeof h]
  probe: () => ProbeOptions
}[] = [
  {
    name: 'list items',
    fetcher: h.fetchListItems,
    probe: () => ({ queryKey: queryKeys.listItems(listId), queryFn: () => fetchListItems(listId) }),
  },
  {
    name: 'gear',
    fetcher: h.fetchGearItems,
    probe: () => ({ queryKey: queryKeys.gearItems(), queryFn: fetchGearItems }),
  },
  {
    name: 'categories',
    fetcher: h.fetchCategories,
    probe: () => ({ queryKey: queryKeys.categories(), queryFn: fetchCategories }),
  },
  {
    name: 'food',
    fetcher: h.fetchListFood,
    probe: () => ({ queryKey: queryKeys.listFood(listId), queryFn: () => fetchListFood(listId) }),
  },
]

const views = [
  { name: 'List', path: `/lists/${listId}` },
  { name: 'Pack', path: `/lists/${listId}/pack` },
] as const

const cases = views.flatMap((view) => sources.map((source) => ({ view, source })))

const ROUTES = ['/lists/:id', '/lists/:id/pack']
const ERROR_PANEL = "Couldn't load list details"

// The gear picker beside the list also names the gear, and it sits outside
// the gate, so a row is only found inside the document column.
const documentColumn = () => screen.getByTestId('list-document-column')

// Waiting on qc.getQueryState is not enough: the cache reaches 'error' before
// any observer re-renders, so an assertion made then still sees the old DOM.
// A rendered probe that reports the error has crossed the same render the
// page has to cross.
function QueryProbe({ options }: { options: ProbeOptions }) {
  const { status, fetchStatus } = useQuery(options)
  return <span data-testid="probe-status">{`${status}:${fetchStatus}`}</span>
}

beforeEach(() => {
  stubViewport(1280)
  h.fetchLists.mockResolvedValue([list])
  h.fetchListItems.mockResolvedValue([listItem])
  h.fetchGearItems.mockResolvedValue([gear])
  h.fetchCategories.mockResolvedValue([] as Category[])
  h.fetchPackingLocations.mockResolvedValue([] as PackingLocation[])
  h.fetchListFood.mockResolvedValue(emptyFood)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('ListDetailPage detail-data gate', () => {
  it.each(cases)(
    'a failed first load of $source.name shows the error panel on the $view.name view',
    async ({ view, source }) => {
      source.fetcher.mockRejectedValue(new Error('offline'))
      await renderListDetailPage(view.path, ROUTES)

      expect(await screen.findByText(ERROR_PANEL)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
    },
  )

  it.each(cases)(
    'a failed refetch of $source.name keeps the rendered $view.name view',
    async ({ view, source }) => {
      const client = await renderListDetailPage(view.path, ROUTES, {
        beside: <QueryProbe options={source.probe()} />,
      })
      // Past the gate: the row only renders once every collection resolved.
      await waitFor(() =>
        expect(within(documentColumn()).getByText('Cooking pot')).toBeInTheDocument(),
      )

      source.fetcher.mockRejectedValue(new Error('offline'))
      void client.refetchQueries({ queryKey: source.probe().queryKey })
      await waitFor(() =>
        expect(screen.getByTestId('probe-status')).toHaveTextContent('error:idle'),
      )

      expect(within(documentColumn()).getByText('Cooking pot')).toBeInTheDocument()
      expect(screen.queryByText(ERROR_PANEL)).not.toBeInTheDocument()
    },
  )
})
