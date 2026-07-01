// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import type { Category, GearItem } from '../lib/types'

const h = vi.hoisted(() => ({
  bulkDeleteMutate: vi.fn<(ids: string[], options?: { onSuccess?: () => void }) => void>(),
  bulkMoveMutate: vi.fn<(
    input: { ids: string[]; categoryId: string | null },
    options?: { onSuccess?: () => void },
  ) => void>(),
  fetchGearItems: vi.fn<() => Promise<GearItem[]>>(),
  fetchListCount: vi.fn<() => Promise<number>>(),
}))

vi.mock('../auth/use-require-session', () => ({
  useRequireSession: () => ({ userId: 'u1' }),
}))

vi.mock('../lib/queries', () => ({
  queryKeys: {
    categories: () => ['categories'],
    gearItems: () => ['gear-items'],
    listCount: () => ['lists', 'count'],
    lists: () => ['lists'],
    listItems: (listId: string) => ['list-items', listId],
  },
  fetchGearItems: h.fetchGearItems,
  fetchListCount: h.fetchListCount,
  fetchLists: vi.fn(),
  reorderCategories: vi.fn(),
  reorderGearItems: vi.fn(),
  createListFromSelection: vi.fn(),
  nextListSortOrder: vi.fn(() => 0),
  importGearItems: vi.fn(),
  makeOptimisticReorder: vi.fn(() => ({})),
}))

vi.mock('../lib/use-reorderable', () => ({
  useReorderable: () => ({
    items: [category({ id: 'c1', name: 'Shelter' })],
    reorderPending: false,
    handleDragStart: vi.fn(),
    handleDragCancel: vi.fn(),
    handleDragEnd: vi.fn(),
  }),
}))

vi.mock('../lib/use-breakpoint', () => ({ useIsBelowLg: () => false }))
vi.mock('../lib/use-weight-unit', () => ({ useWeightUnit: () => ({ weightUnit: 'g' }) }))

vi.mock('@dnd-kit/core', async () => {
  const actual = await vi.importActual<typeof import('@dnd-kit/core')>('@dnd-kit/core')
  return {
    ...actual,
    DndContext: ({ children }: { children: ReactNode }) => <div>{children}</div>,
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

vi.mock('./CategorySection', () => ({
  SortableCategorySection: (props: {
    selectedIds: Set<string>
    onToggleSelect: (id: string) => void
  }) => (
    <section>
      <button type="button" onClick={() => props.onToggleSelect('g1')}>
        {props.selectedIds.has('g1') ? 'Deselect tent' : 'Select tent'}
      </button>
    </section>
  ),
  StaticCategorySection: () => null,
}))

vi.mock('./BulkActionsToolbar', () => ({
  default: (props: {
    selectedCount: number
    onDelete: () => void
    onMoveToCategory: () => void
  }) => (
    <div>
      <p>{props.selectedCount} selected</p>
      <button type="button" onClick={props.onDelete}>Bulk delete</button>
      <button type="button" onClick={props.onMoveToCategory}>Move selected</button>
    </div>
  ),
}))

vi.mock('./BulkMoveCategoryDialog', () => ({
  default: (props: { onMove: (categoryId: string | null) => void }) => (
    <div role="dialog" aria-label="Move selected">
      <button type="button" onClick={() => props.onMove(null)}>Move to uncategorized</button>
    </div>
  ),
}))

vi.mock('./MobileGearActionBar', () => ({ default: () => null }))

vi.mock('./use-gear-item-actions', () => ({
  useGearItemActions: () => ({
    addItem: { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false },
    editItem: { mutate: vi.fn(), isPending: false },
    removeItem: { mutate: vi.fn() },
  }),
}))

vi.mock('./use-gear-category-actions', () => ({
  useGearCategoryActions: () => ({
    addCategory: { mutate: vi.fn(), mutateAsync: vi.fn() },
    renameCategory: { mutate: vi.fn() },
    removeCategory: { mutate: vi.fn() },
  }),
}))

vi.mock('./use-gear-bulk-actions', () => ({
  useGearBulkActions: () => ({
    bulkDelete: { mutate: h.bulkDeleteMutate },
    bulkMove: { mutate: h.bulkMoveMutate },
  }),
}))

import GearLibraryPage from './GearLibraryPage'

function category(over: Partial<Category> = {}): Category {
  return {
    id: 'c1',
    user_id: 'u1',
    name: 'Shelter',
    sort_order: 0,
    is_default: false,
    created_at: '2026-01-01T00:00:00.000Z',
    ...over,
  }
}

function gear(over: Partial<GearItem> = {}): GearItem {
  return {
    id: 'g1',
    user_id: 'u1',
    category_id: 'c1',
    name: 'Tent',
    description: null,
    weight_grams: 1000,
    cost: null,
    purchase_date: null,
    status: 'active',
    sort_order: 0,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...over,
  }
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <GearLibraryPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

async function selectOneItem() {
  fireEvent.click(await screen.findByRole('button', { name: 'Select' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Select tent' }))
  expect(screen.getByText('1 selected')).toBeInTheDocument()
}

beforeEach(() => {
  h.fetchGearItems.mockResolvedValue([gear()])
  h.fetchListCount.mockResolvedValue(1)
  h.bulkDeleteMutate.mockImplementation((_ids, options) => options?.onSuccess?.())
  h.bulkMoveMutate.mockImplementation((_input, options) => options?.onSuccess?.())
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('GearLibraryPage bulk success handling', () => {
  it('exits select mode after a successful bulk delete', async () => {
    renderPage()
    await selectOneItem()

    fireEvent.click(screen.getByRole('button', { name: 'Bulk delete' }))

    expect(h.bulkDeleteMutate).toHaveBeenCalledWith(['g1'], expect.objectContaining({ onSuccess: expect.any(Function) }))
    await waitFor(() => expect(screen.queryByText('1 selected')).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Select' })).toBeInTheDocument()
  })

  it('exits select mode and closes the move dialog after a successful bulk move', async () => {
    renderPage()
    await selectOneItem()

    fireEvent.click(screen.getByRole('button', { name: 'Move selected' }))
    fireEvent.click(screen.getByRole('button', { name: 'Move to uncategorized' }))

    expect(h.bulkMoveMutate).toHaveBeenCalledWith(
      { ids: ['g1'], categoryId: null },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    )
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Move selected' })).not.toBeInTheDocument())
    expect(screen.queryByText('1 selected')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Select' })).toBeInTheDocument()
  })
})
