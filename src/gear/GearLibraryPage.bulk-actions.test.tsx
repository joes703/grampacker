// @vitest-environment jsdom
// Type-side import for the jest-dom matchers (toBeInTheDocument, ...).
// vitest.setup.ts registers them at runtime for every test file; this
// import is what brings the vitest module augmentation into tsc's
// program for THIS file, so each matcher-using test stays self-typed.
import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import type { Category, GearItem } from '../lib/types'

// TRANSPLANT NOTE: the old repo's suite also covered the CSV import
// explainer routing and export failure toast (return at phase 2 step 4).

const h = vi.hoisted(() => ({
  bulkDeleteMutate: vi.fn<(ids: string[], options?: { onSuccess?: () => void }) => void>(),
  bulkMoveMutate: vi.fn<(
    input: { ids: string[]; categoryId: string | null },
    options?: { onSuccess?: () => void },
  ) => void>(),
  reorderableItems: vi.fn<() => Category[]>(),
  reorderableLoading: vi.fn<() => boolean>(),
  reorderableError: vi.fn<() => boolean>(),
  fetchGearItems: vi.fn<() => Promise<GearItem[]>>(),
  removeCategoryMutate: vi.fn<(id: string, options?: { onSuccess?: () => void }) => void>(),
}))

vi.mock('../lib/queries', () => ({
  queryKeys: {
    categories: () => ['categories'],
    gearItems: () => ['gear-items'],
    lists: () => ['lists'],
    listItems: (id: string) => ['list-items', id],
  },
  fetchCategories: vi.fn(),
  fetchGearItems: h.fetchGearItems,
  // The page subscribes to the lists cache for the create-list dialog's
  // LIST_CAP warning; resolve empty so listCount renders as 0 here.
  fetchLists: vi.fn(async () => []),
  createListFromSelection: vi.fn(),
  reorderCategories: vi.fn(),
  reorderGearItems: vi.fn(),
  makeOptimisticReorder: vi.fn(() => ({})),
}))

vi.mock('../lib/use-reorderable', () => ({
  useReorderable: () => ({
    items: h.reorderableItems(),
    isLoading: h.reorderableLoading(),
    isError: h.reorderableError(),
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
    category: Category
    selectedIds: Set<string>
    onToggleSelect: (id: string) => void
    onDeleteCategory: (category: Category) => void
  }) => (
    <section>
      <button type="button" onClick={() => props.onToggleSelect('g1')}>
        {props.selectedIds.has('g1') ? 'Deselect tent' : 'Select tent'}
      </button>
      <button type="button" onClick={() => props.onDeleteCategory(props.category)}>
        Delete category
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
    removeCategory: { mutate: h.removeCategoryMutate },
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
    name: 'Shelter',
    sortOrder: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...over,
  }
}

function gear(over: Partial<GearItem> = {}): GearItem {
  return {
    id: 'g1',
    categoryId: 'c1',
    name: 'Tent',
    description: null,
    weightGrams: 1000,
    cost: null,
    purchaseDate: null,
    status: 'active',
    sortOrder: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
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

beforeEach(() => {
  h.reorderableItems.mockReturnValue([category({ id: 'c1', name: 'Shelter' })])
  h.reorderableLoading.mockReturnValue(false)
  h.reorderableError.mockReturnValue(false)
  h.fetchGearItems.mockResolvedValue([gear()])
  h.bulkDeleteMutate.mockImplementation((_ids, options) => options?.onSuccess?.())
  h.bulkMoveMutate.mockImplementation((_input, options) => options?.onSuccess?.())
  h.removeCategoryMutate.mockImplementation((_id, options) => options?.onSuccess?.())
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('GearLibraryPage route identity', () => {
  it('renders one Gear route heading', async () => {
    renderPage()

    expect(await screen.findByRole('heading', { level: 1, name: 'Gear' })).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  })
})

describe('GearLibraryPage bulk success handling', () => {
  it('shows a first-run empty state when there are no categories or gear items', async () => {
    h.reorderableItems.mockReturnValue([])
    h.fetchGearItems.mockResolvedValue([])

    renderPage()

    expect(await screen.findByText('No gear yet')).toBeInTheDocument()
    expect(screen.getByText('Add your first item, import a CSV, or create a category to start organizing your gear library.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add item' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Import CSV' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New category' })).toBeInTheDocument()
  })

  it('does not show the first-run empty state while categories are still loading', async () => {
    h.reorderableItems.mockReturnValue([])
    h.reorderableLoading.mockReturnValue(true)
    h.fetchGearItems.mockResolvedValue([])

    renderPage()

    expect(await screen.findByText('Loading…')).toBeInTheDocument()
    expect(screen.queryByText('No gear yet')).not.toBeInTheDocument()
  })

  it('does not show the first-run empty state after a category load failure', async () => {
    h.reorderableItems.mockReturnValue([])
    h.reorderableError.mockReturnValue(true)
    h.fetchGearItems.mockResolvedValue([])

    renderPage()

    expect(await screen.findByText("Couldn't load gear library. Refresh the page and try again.")).toBeInTheDocument()
    expect(screen.queryByText('No gear yet')).not.toBeInTheDocument()
  })

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

describe('GearLibraryPage category delete confirmation', () => {
  it('requires confirmation before deleting an empty category', async () => {
    h.fetchGearItems.mockResolvedValueOnce([])
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: 'Delete category' }))

    expect(h.removeCategoryMutate).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'Delete category' })).toBeInTheDocument()
    expect(screen.getByText('Delete "Shelter"? Items in this category will become uncategorized.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    expect(h.removeCategoryMutate).toHaveBeenCalledWith('c1', expect.objectContaining({ onSuccess: expect.any(Function) }))
  })
})
