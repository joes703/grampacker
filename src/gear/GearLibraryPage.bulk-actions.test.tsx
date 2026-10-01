// @vitest-environment jsdom
// Type-side import for the jest-dom matchers (toBeInTheDocument, ...).
// vitest.setup.ts registers them at runtime for every test file; this
// import is what brings the vitest module augmentation into tsc's
// program for THIS file, so each matcher-using test stays self-typed.
import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
  reorderablePending: vi.fn<() => boolean>(),
  reorderableFailed: vi.fn<() => boolean>(),
  fetchGearItems: vi.fn<() => Promise<GearItem[]>>(),
  // Deliberately typed with no options argument: the delete confirms close on the
  // click, not on onSuccess (see the confirmation test below), so re-introducing a
  // callback here should be a type error rather than a silent behavior change.
  removeCategoryMutate: vi.fn<(id: string) => void>(),
  bulkDeletePending: vi.fn<() => boolean>(),
  bulkMovePending: vi.fn<() => boolean>(),
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
    isPending: h.reorderablePending(),
    isLoadingError: h.reorderableFailed(),
    refetch: vi.fn(),
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
    busy: boolean
    onClose: () => void
    onDelete: () => void
    onMoveToCategory: () => void
  }) => (
    <div>
      <p>{props.selectedCount} selected</p>
      <button type="button" onClick={props.onClose}>Exit selection mode</button>
      <button type="button" onClick={props.onDelete} disabled={props.busy}>Bulk delete</button>
      <button type="button" onClick={props.onMoveToCategory} disabled={props.busy}>Move selected</button>
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
    bulkDelete: { mutate: h.bulkDeleteMutate, isPending: h.bulkDeletePending() },
    bulkMove: { mutate: h.bulkMoveMutate, isPending: h.bulkMovePending() },
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
  // Select is disabled until BOTH halves of the library are in hand - it is
  // the doorway to bulk move and bulk delete, which write against that
  // snapshot. Waiting for it to become enabled is the harness equivalent of
  // the user waiting for the page to finish loading.
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Select' })).toBeEnabled(),
  )
  fireEvent.click(screen.getByRole('button', { name: 'Select' }))
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
  h.reorderablePending.mockReturnValue(false)
  h.reorderableFailed.mockReturnValue(false)
  h.fetchGearItems.mockResolvedValue([gear()])
  h.bulkDeleteMutate.mockImplementation((_ids, options) => options?.onSuccess?.())
  h.bulkMoveMutate.mockImplementation((_input, options) => options?.onSuccess?.())
  h.bulkDeletePending.mockReturnValue(false)
  h.bulkMovePending.mockReturnValue(false)
  // removeCategoryMutate is deliberately left inert - it never calls back. The
  // confirm must close without it.
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  // onlineManager is module-level state shared by every test in the file, so
  // the offline cold-load case has to hand it back.
  onlineManager.setOnline(true)
})

describe('GearLibraryPage route identity', () => {
  it('renders one Gear route heading', async () => {
    renderPage()

    expect(await screen.findByRole('heading', { level: 1, name: 'Gear' })).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole('searchbox', { name: 'Search gear' })).toBeInTheDocument()
  })
})

describe('GearLibraryPage bulk success handling', () => {
  it('shows one search-empty message and restores empty categories when search clears', async () => {
    h.reorderableItems.mockReturnValue([
      category({ id: 'c1', name: 'Shelter' }),
      category({ id: 'c2', name: 'Cooking' }),
    ])
    h.fetchGearItems.mockResolvedValue([gear({ name: 'Tent' })])
    renderPage()

    fireEvent.change(await screen.findByRole('searchbox', { name: 'Search gear' }), {
      target: { value: 'stove' },
    })

    expect(await screen.findByText('No gear matches \u201cstove\u201d.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete category' })).not.toBeInTheDocument()

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search gear' }), {
      target: { value: '' },
    })

    expect(await screen.findAllByRole('button', { name: 'Delete category' })).toHaveLength(2)
    expect(screen.queryByText(/No gear matches/)).not.toBeInTheDocument()
  })

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
    h.reorderablePending.mockReturnValue(true)
    h.fetchGearItems.mockResolvedValue([])

    renderPage()

    expect(await screen.findByText('Loading…')).toBeInTheDocument()
    expect(screen.queryByText('No gear yet')).not.toBeInTheDocument()
  })

  it('does not show the first-run empty state after a category load failure', async () => {
    h.reorderableItems.mockReturnValue([])
    h.reorderableFailed.mockReturnValue(true)
    h.fetchGearItems.mockResolvedValue([])

    renderPage()

    expect(await screen.findByText("Couldn't load your gear")).toBeInTheDocument()
    expect(screen.queryByText('No gear yet')).not.toBeInTheDocument()
    // /lists has offered a retry for the same failure since PR 4.1; telling a
    // gear user to "refresh the page" was the odd one out.
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })

  // The gear half of the same trap, and the one that was live: v5's isLoading
  // is `isPending && isFetching`, so a cold load with the browser offline parks
  // at fetchStatus 'paused' and reports isLoading FALSE with zero rows. The
  // page fell straight through to the empty state and pitched onboarding at a
  // user who owns a full library and is merely offline.
  it('does not show the first-run empty state on a cold load that is paused offline', async () => {
    h.reorderableItems.mockReturnValue([])
    // Parked, not rejected: this is the state that reports isLoading false.
    h.fetchGearItems.mockImplementation(() => new Promise(() => {}))
    onlineManager.setOnline(false)

    renderPage()

    expect(await screen.findByText('Loading…')).toBeInTheDocument()
    expect(screen.queryByText('No gear yet')).not.toBeInTheDocument()
  })

  describe('library action gate', () => {
    // Every action behind these controls builds its write from the gear +
    // category snapshot, and both arrays are [] while pending or failed. See
    // libraryReady in GearLibraryPage for what each one gets wrong.
    async function expectActionsDisabled() {
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'New item' })).toBeDisabled(),
      )
      expect(screen.getByRole('button', { name: 'Select' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Gear options' })).toBeDisabled()
    }

    it('disables New item, Select and Options while the gear fetch is in flight', async () => {
      h.fetchGearItems.mockImplementation(() => new Promise(() => {}))
      renderPage()
      await expectActionsDisabled()
    })

    it('disables them after a gear load failure', async () => {
      h.fetchGearItems.mockRejectedValue(new Error('offline'))
      renderPage()
      await expectActionsDisabled()
    })

    // Categories failing alone is the case the old `canExport` missed: gear is
    // in hand, so Export looked safe, but gearItemsToCsv resolves category
    // NAMES out of the categories array and would have written a blank cell
    // for every row.
    it('disables them when only the categories failed', async () => {
      h.reorderableFailed.mockReturnValue(true)
      renderPage()
      await expectActionsDisabled()
    })

    it('enables them once both halves have resolved', async () => {
      renderPage()
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'New item' })).toBeEnabled(),
      )
      expect(screen.getByRole('button', { name: 'Select' })).toBeEnabled()
      expect(screen.getByRole('button', { name: 'Gear options' })).toBeEnabled()
    })

    // Cancel is the way OUT of a mode, never a write. Gating it alongside the
    // rest would trap a user in select mode.
    it('never disables Cancel in select mode', async () => {
      renderPage()
      await selectOneItem()
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled()
    })
  })

  it('asks before a bulk delete, and Cancel deletes nothing', async () => {
    renderPage()
    await selectOneItem()

    fireEvent.click(screen.getByRole('button', { name: 'Bulk delete' }))

    expect(h.bulkDeleteMutate).not.toHaveBeenCalled()
    const confirm = screen.getByRole('dialog', { name: 'Delete selected items' })
    expect(within(confirm).getByText(/remove 1 item from your inventory/)).toBeInTheDocument()

    fireEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }))

    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Delete selected items' })).not.toBeInTheDocument(),
    )
    expect(h.bulkDeleteMutate).not.toHaveBeenCalled()
    expect(screen.getByText('1 selected')).toBeInTheDocument()
  })

  it('exits select mode after a confirmed bulk delete succeeds', async () => {
    renderPage()
    await selectOneItem()

    fireEvent.click(screen.getByRole('button', { name: 'Bulk delete' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

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

  // The move is optimistic, so the rows have already moved when Move is clicked.
  // The dialog closes on the CLICK: it has nothing left to show. Select mode
  // survives until success, so a failed move leaves the selection in place to
  // retry.
  it('closes the move dialog on the click, and keeps the selection until the move succeeds', async () => {
    h.bulkMoveMutate.mockImplementation(() => {})
    renderPage()
    await selectOneItem()

    fireEvent.click(screen.getByRole('button', { name: 'Move selected' }))
    fireEvent.click(screen.getByRole('button', { name: 'Move to uncategorized' }))

    expect(screen.queryByRole('dialog', { name: 'Move selected' })).not.toBeInTheDocument()
    expect(screen.getByText('1 selected')).toBeInTheDocument()

    const options = h.bulkMoveMutate.mock.calls[0]?.[1]
    act(() => options?.onSuccess?.())
    expect(screen.queryByText('1 selected')).not.toBeInTheDocument()
  })

  // Each bulk write rolls back by restoring a whole-cache snapshot, so a second
  // one started while the first is in flight can be undone by the first's
  // failure. Only one runs at a time; the way out stays reachable.
  it.each([
    ['move', h.bulkMovePending],
    ['delete', h.bulkDeletePending],
  ])('disables the bulk actions, but not the exit, while a bulk %s is in flight', async (_label, pending) => {
    pending.mockReturnValue(true)
    renderPage()
    await selectOneItem()

    expect(screen.getByRole('button', { name: 'Move selected' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Bulk delete' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Exit selection mode' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled()
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

    // Close-then-mutate: the id alone, no onSuccess. `removeCategoryMutate` is
    // inert in this suite, so the confirm has to be gone WITHOUT the mutation ever
    // settling - which is what makes this non-vacuous. The old assertion passed
    // against a mock that synchronously invoked onSuccess, so it could not tell
    // close-on-click from close-on-success, which is the behavior every delete
    // confirm shares (see src/lib/mutation-error-handler.ts).
    expect(h.removeCategoryMutate).toHaveBeenCalledWith('c1')
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Delete category' })).not.toBeInTheDocument(),
    )
  })
})
