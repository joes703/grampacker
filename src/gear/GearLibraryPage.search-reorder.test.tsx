// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { makeDnDId } from '../lib/dnd-ids'
import { mutationKeys } from '../lib/queries/keys'
import type { Category, GearItem } from '../lib/types'

// A within-category drag while search is narrowing the library.
//
// Search hides rows without moving them, so the sequence the user drags within
// is the category's MATCHING rows. The planner has to use that same sequence:
// counting a hidden row computes the move against rows the user cannot see and
// rewrites the hidden row's position as a side effect.

const h = vi.hoisted(() => ({
  fetchGearItems: vi.fn(),
  reorderGearItems: vi.fn(),
  // The drag the passthrough fires: set per test, default Tent onto Tarp.
  drag: { activeId: '', overId: '' },
}))

vi.mock('../lib/queries', () => ({
  queryKeys: {
    categories: () => ['categories'],
    gearItems: () => ['gear-items'],
    lists: () => ['lists'],
    listItems: (id: string) => ['list-items', id],
    listItemsAll: () => ['list-items'],
  },
  fetchCategories: vi.fn(),
  fetchGearItems: h.fetchGearItems,
  // The category actions hook is not mocked, so its query layer is. The
  // optimistic helpers collapse to empty lifecycles: the subject here is the
  // payload the page plans, not the cache.
  createCategory: vi.fn(),
  renameCategory: vi.fn(),
  deleteCategory: vi.fn(),
  nextCategorySortOrder: () => 0,
  makeOptimisticInsert: () => ({}),
  makeOptimisticUpdate: () => ({}),
  makeOptimisticDelete: () => ({}),
  fetchLists: vi.fn(async () => []),
  createListFromSelection: vi.fn(),
  reorderCategories: vi.fn(),
  reorderGearItems: h.reorderGearItems,
  makeOptimisticReorder: vi.fn(() => ({})),
}))

vi.mock('../lib/use-reorderable', () => ({
  useReorderable: () => ({
    items: [shelter],
    isPending: false,
    isLoadingError: false,
    refetch: vi.fn(),
    reorderPending: false,
    handleDragStart: vi.fn(),
    handleDragCancel: vi.fn(),
    handleDragEnd: vi.fn(),
  }),
}))

vi.mock('../lib/use-breakpoint', () => ({ useIsBelowLg: () => false }))
vi.mock('../lib/use-weight-unit', () => ({ useWeightUnit: () => ({ weightUnit: 'g' }) }))

// dnd-kit cannot be driven by a synthetic pointer sequence in jsdom. The
// passthrough exposes the page's own onDragEnd, which is where the page plans
// the reorder - the part under test.
vi.mock('@dnd-kit/core', async () => {
  const actual = await vi.importActual<typeof import('@dnd-kit/core')>('@dnd-kit/core')
  return {
    ...actual,
    DndContext: ({ children, onDragEnd }: {
      children: ReactNode
      onDragEnd?: (e: unknown) => void
    }) => (
      <div>
        <button
          type="button"
          onClick={() => onDragEnd?.({
            active: { id: makeDnDId('gear-item', h.drag.activeId) },
            over: { id: makeDnDId('gear-item', h.drag.overId) },
          })}
        >
          fire drag end
        </button>
        {children}
      </div>
    ),
    DragOverlay: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    useSensor: vi.fn(),
    useSensors: vi.fn(() => []),
  }
})

vi.mock('@dnd-kit/sortable', async () => {
  const actual = await vi.importActual<typeof import('@dnd-kit/sortable')>('@dnd-kit/sortable')
  return {
    ...actual,
    SortableContext: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  }
})

// Stands in for the row surface: just the names of the rows the page handed
// the section, which is what the assertions on "what is on screen" read.
vi.mock('./CategorySection', () => ({
  SortableCategorySection: (props: { items: GearItem[] }) => (
    <section>
      {props.items.map((item) => <div key={item.id}>{item.name}</div>)}
    </section>
  ),
  StaticCategorySection: () => null,
}))

vi.mock('./GearOptionsButton', () => ({ default: () => null }))
vi.mock('./MobileGearActionBar', () => ({ default: () => null }))
vi.mock('./BulkActionsToolbar', () => ({ default: () => null }))

vi.mock('./use-gear-item-actions', () => ({
  useGearItemActions: () => ({
    addItem: { mutateAsync: vi.fn(), isPending: false },
    editItem: { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false },
    removeItem: { mutate: vi.fn() },
  }),
}))

vi.mock('./use-gear-bulk-actions', () => ({
  useGearBulkActions: () => ({
    bulkDelete: { mutate: vi.fn() },
    bulkMove: { mutate: vi.fn() },
  }),
}))

import GearLibraryPage from './GearLibraryPage'

const shelter: Category = {
  id: 'c1',
  name: 'Shelter',
  sortOrder: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
}

function gear(id: string, name: string, sortOrder: number): GearItem {
  return {
    id,
    categoryId: shelter.id,
    name,
    description: null,
    weightGrams: 100,
    cost: null,
    purchaseDate: null,
    status: 'active',
    sortOrder,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

// Searching "t" matches Tent and Tarp and hides Guylines, which sits between
// them.
const tent = gear('g-tent', 'Tent', 0)
const guylines = gear('g-guylines', 'Guylines', 1)
const tarp = gear('g-tarp', 'Tarp', 2)

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <GearLibraryPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return qc
}

beforeEach(() => {
  h.drag.activeId = tent.id
  h.drag.overId = tarp.id
  h.fetchGearItems.mockResolvedValue([tent, guylines, tarp])
  h.reorderGearItems.mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('a gear drag within a category', () => {
  it('without a search, permutes the whole category', async () => {
    renderPage()
    await screen.findByText('Guylines')

    fireEvent.click(screen.getByRole('button', { name: 'fire drag end' }))

    await waitFor(() => expect(h.reorderGearItems).toHaveBeenCalledTimes(1))
    expect(h.reorderGearItems.mock.calls[0]?.[0]).toEqual([
      { id: guylines.id, sortOrder: 0 },
      { id: tarp.id, sortOrder: 1 },
      { id: tent.id, sortOrder: 2 },
    ])
  })

  it('while searching, plans against the matching rows and leaves hidden rows alone', async () => {
    renderPage()
    await screen.findByText('Guylines')

    fireEvent.change(screen.getByLabelText('Search gear'), { target: { value: 't' } })
    await waitFor(() => expect(screen.queryByText('Guylines')).not.toBeInTheDocument())
    expect(screen.getByText('Tent')).toBeInTheDocument()
    expect(screen.getByText('Tarp')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'fire drag end' }))

    // Tent dropped on Tarp: the two visible rows swap their own slots (0 and
    // 2). Guylines keeps slot 1 and is not in the payload.
    await waitFor(() => expect(h.reorderGearItems).toHaveBeenCalledTimes(1))
    expect(h.reorderGearItems.mock.calls[0]?.[0]).toEqual([
      { id: tarp.id, sortOrder: 0 },
      { id: tent.id, sortOrder: 2 },
    ])
  })

  // A drag can end on a row the search has since hidden (typing mid-drag),
  // or start from one. Neither endpoint is in the sequence the user sees, so
  // there is no move to plan.
  it.each([
    ['from a hidden row', () => guylines.id, () => tarp.id],
    ['onto a hidden row', () => tent.id, () => guylines.id],
  ])('while searching, writes nothing for a drag %s', async (_label, activeId, overId) => {
    h.drag.activeId = activeId()
    h.drag.overId = overId()
    const qc = renderPage()
    await screen.findByText('Guylines')

    fireEvent.change(screen.getByLabelText('Search gear'), { target: { value: 't' } })
    await waitFor(() => expect(screen.queryByText('Guylines')).not.toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'fire drag end' }))

    // The handler calls mutate() synchronously, and mutate() registers the
    // mutation in the cache before its request goes out. So an empty cache
    // straight after the click means no reorder was started - no waiting for
    // an absence.
    expect(
      qc.getMutationCache().findAll({ mutationKey: mutationKeys.reorderGearItems() }),
    ).toHaveLength(0)
    expect(h.reorderGearItems).not.toHaveBeenCalled()
  })
})
