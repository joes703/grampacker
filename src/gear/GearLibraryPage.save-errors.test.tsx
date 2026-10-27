// @vitest-environment jsdom
// Type-side import for the jest-dom matchers; see the note in
// GearLibraryPage.bulk-actions.test.tsx.
import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import type { Category, GearItem } from '../lib/types'

// What this file is for: the gear library's OWN writes - add/edit/delete an item,
// add/delete a category, create a list from a selection - all failed silently. (The
// bulk actions, the reorders, and CSV import/export already had surfaces of their
// own; they are not what this file is about.) The mutations are mocked here (their
// optimistic wiring is covered in use-gear-*-actions.test.tsx) because the subject
// is the page's failure SURFACE - which error appears where, whether the user's
// draft survives it, and whether a late answer can land on the wrong dialog.
//
// GearItemDialog itself is deliberately NOT mocked. A mock would let a test assert
// that a `saveError` prop was passed while the real dialog rendered nothing, which
// is precisely the regression worth catching.
//
// Anything that asserts WHEN something happened is driven by a DEFERRED mutation
// the test settles by hand: a mock that calls back synchronously cannot tell
// "closes on click" from "closes on success", and cannot observe the window in
// which a surface is open with a request outstanding - which is where these bugs
// live. Tests that only assert WHAT is rendered on a settled outcome use a
// synchronous callback, and say so.

type Deferred = {
  promise: Promise<unknown>
  resolve: (value?: unknown) => void
  reject: (reason?: unknown) => void
}

function deferred(): Deferred {
  let resolve!: (value?: unknown) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<unknown>((res, rej) => {
    resolve = res as (value?: unknown) => void
    reject = rej
  })
  // Nothing awaits the promise until the component does, and a rejection settled
  // before that would be an unhandled rejection in the test runner itself.
  promise.catch(() => {})
  return { promise, resolve, reject }
}

// Wait for the component's own continuation on a settled deferred, and for React to
// flush whatever state update it made. Promise reactions run FIFO and the component
// registered its await at click time, so by the time this returns the guard has
// already had its say. The two stale-completion tests below assert an ABSENCE, so
// they need this: a bare `waitFor` on something already true returns before the
// continuation has run, and would pass against a page with no guard at all.
async function settle(d: Deferred): Promise<void> {
  await act(async () => {
    await d.promise.catch(() => {})
  })
}

const h = vi.hoisted(() => ({
  addItemAsync: vi.fn<(patch: unknown) => Promise<unknown>>(),
  editItemAsync: vi.fn<(input: unknown) => Promise<unknown>>(),
  removeItemMutate: vi.fn<(id: string) => void>(),
  createCategory: vi.fn<(name: string) => Promise<unknown>>(),
  createListFromSelection: vi.fn<(input: unknown) => Promise<unknown>>(),
  addItemPending: vi.fn<() => boolean>(),
  editItemPending: vi.fn<() => boolean>(),
  reorderableItems: vi.fn<() => Category[]>(),
  fetchGearItems: vi.fn<() => Promise<GearItem[]>>(),
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
  // The category actions hook is NOT mocked in this file (see the note by the
  // cross-surface test), so its query layer has to be. The optimistic helpers
  // collapse to empty lifecycles: their behavior is queries/optimistic.test.ts's
  // subject, and here they would only add cache noise.
  createCategory: h.createCategory,
  renameCategory: vi.fn(),
  deleteCategory: vi.fn(),
  nextSortOrder: () => 0,
  makeOptimisticInsert: () => ({}),
  makeOptimisticUpdate: () => ({}),
  makeOptimisticDelete: () => ({}),
  fetchLists: vi.fn(async () => []),
  createListFromSelection: h.createListFromSelection,
  reorderCategories: vi.fn(),
  reorderGearItems: vi.fn(),
  makeOptimisticReorder: vi.fn(() => ({})),
}))

vi.mock('../lib/use-reorderable', () => ({
  useReorderable: () => ({
    items: h.reorderableItems(),
    isPending: false,
    isLoadingError: false,
    refetch: vi.fn(),
    reorderPending: false,
    handleDragStart: vi.fn(),
    handleDragCancel: vi.fn(),
    handleDragEnd: vi.fn(),
  }),
}))

// Captured so a test can fire the CSV callbacks directly: they run in a
// non-event context (a file read settling), which is the only way this page
// QUEUES a dialog replacement without React committing it in the same call -
// the window the same-tick regression test below needs.
const csv = vi.hoisted(() => ({
  onError: undefined as ((message: string) => void) | undefined,
}))
vi.mock('../lib/use-csv-file-input', () => ({
  useCsvFileInput: (
    _parse: unknown,
    handlers: { onError: (message: string) => void },
  ) => {
    csv.onError = handlers.onError
    return { inputRef: { current: null }, onChange: vi.fn(), openPicker: vi.fn() }
  },
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

// Stands in for the row surface: the two entry points this file needs are the
// kebab's Edit and Delete, reduced to plain buttons.
vi.mock('./CategorySection', () => ({
  SortableCategorySection: (props: {
    items: GearItem[]
    onEditItem: (item: GearItem) => void
    onDeleteItem: (item: GearItem) => void
  }) => (
    <section>
      {props.items.map((item) => (
        <div key={item.id}>
          <button type="button" onClick={() => props.onEditItem(item)}>
            {`Edit ${item.name}`}
          </button>
          <button type="button" onClick={() => props.onDeleteItem(item)}>
            {`Delete ${item.name}`}
          </button>
        </div>
      ))}
    </section>
  ),
  StaticCategorySection: () => null,
}))

vi.mock('./GearOptionsButton', () => ({
  default: (props: { gearOptions: { onNewCategory: () => void } }) => (
    <button type="button" onClick={props.gearOptions.onNewCategory}>New category</button>
  ),
}))

vi.mock('./MobileGearActionBar', () => ({ default: () => null }))

// Only the one entry point this file needs: the toolbar action that opens the
// create-list-from-selection dialog.
vi.mock('./BulkActionsToolbar', () => ({
  default: (props: { onCreateList: () => void }) => (
    <button type="button" onClick={props.onCreateList}>Create list from selection</button>
  ),
}))

vi.mock('./use-gear-item-actions', () => ({
  // isPending is driven by the test, not pinned. Defaulting it to false pins that
  // the dialog's "Saving…" comes from the page's per-attempt state; setting it TRUE
  // with no save outstanding pins the other half - that the shared mutation flag,
  // which an inline row edit behind the dialog also raises, no longer leaks in.
  useGearItemActions: () => ({
    addItem: { mutateAsync: h.addItemAsync, isPending: h.addItemPending() },
    editItem: {
      mutate: vi.fn(),
      mutateAsync: h.editItemAsync,
      isPending: h.editItemPending(),
    },
    removeItem: { mutate: h.removeItemMutate },
  }),
}))

vi.mock('./use-gear-bulk-actions', () => ({
  useGearBulkActions: () => ({
    bulkDelete: { mutate: vi.fn() },
    bulkMove: { mutate: vi.fn() },
  }),
}))

import GearLibraryPage from './GearLibraryPage'

function category(over: Partial<Category> = {}): Category {
  return { id: 'c1', name: 'Shelter', sortOrder: 0, createdAt: '2026-01-01T00:00:00.000Z', ...over }
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
}

// "New item" is disabled until BOTH halves of the library have resolved: the
// dialog builds a create from that snapshot, and with categories missing it
// would offer only Uncategorized and POST that null. Every test that opens it
// therefore waits for the page to finish loading first, exactly as a user does.
async function openNewItemDialog() {
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'New item' })).toBeEnabled(),
  )
  fireEvent.click(screen.getByRole('button', { name: 'New item' }))
}

async function enterSelectMode() {
  // Same gate as New item: Select is the doorway to the bulk writes, so it
  // stays disabled until the library snapshot is trustworthy.
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Select' })).toBeEnabled(),
  )
  fireEvent.click(screen.getByRole('button', { name: 'Select' }))
}

function nameField(): HTMLInputElement {
  return screen.getByLabelText(/^Name/) as HTMLInputElement
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
  h.reorderableItems.mockReturnValue([category()])
  h.fetchGearItems.mockResolvedValue([gear()])
  h.addItemPending.mockReturnValue(false)
  h.editItemPending.mockReturnValue(false)
  h.createCategory.mockResolvedValue({ id: 'c-new', name: 'x', sortOrder: 0, createdAt: '' })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('GearItemDialog save failures', () => {
  it('a failed create keeps the dialog open, says so, and does not eat the draft', async () => {
    const d = deferred()
    h.addItemAsync.mockReturnValue(d.promise)
    renderPage()

    await openNewItemDialog()
    fireEvent.change(nameField(), { target: { value: 'Down quilt' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add item' }))

    // While the save is out, the dialog reports it from its own per-attempt state.
    expect(await screen.findByRole('button', { name: 'Saving…' })).toBeInTheDocument()

    d.reject(new Error('offline'))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't confirm the item was created. Refresh before retrying, in case it was.",
    )
    expect(screen.getByRole('dialog', { name: 'New item' })).toBeInTheDocument()
    // The whole point of staying open: retrying must not mean retyping.
    expect(nameField().value).toBe('Down quilt')
  })

  it('a failed edit reports inline, and a retry clears the old message before closing on success', async () => {
    const first = deferred()
    h.editItemAsync.mockReturnValueOnce(first.promise)
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: 'Edit Tent' }))
    fireEvent.change(nameField(), { target: { value: 'Tarp' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    first.reject(new Error('offline'))
    expect(await screen.findByRole('alert')).toBeInTheDocument()

    const second = deferred()
    h.editItemAsync.mockReturnValueOnce(second.promise)
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    // Cleared on the way in, not left showing last time's failure under a
    // spinner. This is the assertion that fails if the retry reuses the state
    // object instead of installing a fresh one.
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())

    second.resolve()
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Edit item' })).not.toBeInTheDocument(),
    )
    expect(h.editItemAsync).toHaveBeenLastCalledWith({
      id: 'g1',
      patch: expect.objectContaining({ name: 'Tarp' }),
    })
  })

  it('a rejection arriving after the user closed the dialog does not resurrect it', async () => {
    // The race the identity guard exists for. Without it the catch would call
    // setDialog with the old state object, re-opening a dismissed dialog - and
    // because it had unmounted, re-opening it means a blank form, so the draft the
    // error is inviting the user to retry has already been thrown away.
    const d = deferred()
    h.addItemAsync.mockReturnValue(d.promise)
    renderPage()

    await openNewItemDialog()
    fireEvent.change(nameField(), { target: { value: 'Down quilt' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add item' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog', { name: 'New item' })).not.toBeInTheDocument()

    d.reject(new Error('offline'))
    await settle(d)

    expect(screen.queryByRole('dialog', { name: 'New item' })).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('a rejection does not stamp its error onto a different dialog opened since', async () => {
    const d = deferred()
    h.addItemAsync.mockReturnValue(d.promise)
    renderPage()

    await openNewItemDialog()
    fireEvent.change(nameField(), { target: { value: 'Down quilt' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add item' }))

    // Abandon the create and go edit something else while it is still out.
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    fireEvent.click(screen.getByRole('button', { name: 'Edit Tent' }))
    expect(screen.getByRole('dialog', { name: 'Edit item' })).toBeInTheDocument()

    d.reject(new Error('offline'))
    await settle(d)

    // The edit dialog is untouched: no borrowed error, and still open.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Edit item' })).toBeInTheDocument()
    expect(nameField().value).toBe('Tent')
  })
})

describe('the inline new-category editor', () => {
  // These run against the REAL useGearCategoryActions, driven by a mocked
  // `createCategory`. See the cross-surface test at the bottom of the file for why
  // the hook is not mocked here.

  it('holds the typed name and shows the failure in place', async () => {
    // Not a toast, for two reasons: `addCategory` is shared with GearItemDialog's
    // create-category affordance, which runs inside a modal where a toast cannot be
    // seen; and closing on the optimistic insert would hide the failure entirely,
    // since the placeholder lands at the end of the category list.
    h.createCategory.mockRejectedValue(new Error('nope'))
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: 'New category' }))
    fireEvent.change(screen.getByPlaceholderText('Category name'), {
      target: { value: 'Sleep system' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't confirm the category was created. Refresh before retrying, in case it was.",
    )
    expect(screen.getByPlaceholderText('Category name')).toHaveValue('Sleep system')
  })

  it('closes and clears only once the create actually succeeds', async () => {
    const d = deferred()
    h.createCategory.mockReturnValue(d.promise)
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: 'New category' }))
    fireEvent.change(screen.getByPlaceholderText('Category name'), {
      target: { value: 'Sleep system' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    // Still open while the request is out - the editor is the retry surface.
    await waitFor(() => expect(h.createCategory).toHaveBeenCalledWith('Sleep system'))
    expect(screen.getByPlaceholderText('Category name')).toBeInTheDocument()

    d.resolve({ id: 'c-new', name: 'Sleep system', sortOrder: 0, createdAt: '' })
    await waitFor(() =>
      expect(screen.queryByPlaceholderText('Category name')).not.toBeInTheDocument(),
    )
  })

  it('canceling drops a previous error rather than leaving it to greet the next attempt', async () => {
    h.createCategory.mockRejectedValue(new Error('nope'))
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: 'New category' }))
    fireEvent.change(screen.getByPlaceholderText('Category name'), { target: { value: 'x' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel new category' }))
    fireEvent.click(screen.getByRole('button', { name: 'New category' }))

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByPlaceholderText('Category name')).toHaveValue('')
  })
})

describe('the delete-item confirmation', () => {
  it('closes on the click and issues exactly one delete, without waiting to be told it worked', async () => {
    // removeItem's mock never calls back. The confirm still goes: the delete is
    // optimistic, and a confirm left over a list that already reflects it is in
    // the way.
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: 'Delete Tent' }))
    expect(screen.getByRole('dialog', { name: 'Delete from inventory' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'Delete from inventory' }),
      ).not.toBeInTheDocument(),
    )
    expect(h.removeItemMutate).toHaveBeenCalledTimes(1)
    expect(h.removeItemMutate).toHaveBeenCalledWith('g1')
  })
})

describe('completions that arrive after the user has moved on', () => {
  // The rejection cases live above. These pin the SUCCESS half of the same guard:
  // an unconditional `setDialog(null)` on success would survive every test above,
  // because closing a dialog the user has already closed looks identical.

  it('a success does not close a different dialog opened since', async () => {
    const d = deferred()
    h.addItemAsync.mockReturnValue(d.promise)
    renderPage()

    await openNewItemDialog()
    fireEvent.change(nameField(), { target: { value: 'Down quilt' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add item' }))

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    fireEvent.click(screen.getByRole('button', { name: 'Edit Tent' }))

    d.resolve()
    await settle(d)

    expect(screen.getByRole('dialog', { name: 'Edit item' })).toBeInTheDocument()
  })

  it('reopening the SAME item does not inherit the abandoned attempt', async () => {
    // The nastiest variant, because the reopened dialog carries the same key and
    // the same item id - only the DialogState object differs. If the guard
    // compared ids instead of identity this would pass an error and a stuck
    // "Saving…" to a session that never submitted anything.
    const d = deferred()
    h.editItemAsync.mockReturnValue(d.promise)
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: 'Edit Tent' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    fireEvent.click(screen.getByRole('button', { name: 'Edit Tent' }))

    d.reject(new Error('offline'))
    await settle(d)

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeInTheDocument()
  })

  it("an older attempt settling does not clear a newer attempt's Saving state", async () => {
    // Out-of-order completion across two dialogs. The `finally` clears the saving
    // slot functionally for exactly this: a plain setSavingAttempt(null) would
    // unfreeze a dialog whose own request is still outstanding.
    const first = deferred()
    h.editItemAsync.mockReturnValue(first.promise)
    const second = deferred()
    h.addItemAsync.mockReturnValue(second.promise)
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: 'Edit Tent' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    await openNewItemDialog()
    fireEvent.change(nameField(), { target: { value: 'Down quilt' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add item' }))
    expect(await screen.findByRole('button', { name: 'Saving…' })).toBeInTheDocument()

    first.resolve()
    await settle(first)

    // Still saving: the create's own request has not come back.
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeInTheDocument()
  })

  it('a save in flight freezes the form, so nothing typed after Save is silently dropped', async () => {
    const d = deferred()
    h.addItemAsync.mockReturnValue(d.promise)
    renderPage()

    await openNewItemDialog()
    fireEvent.change(nameField(), { target: { value: 'Down quilt' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add item' }))

    // The submitted patch is the whole story while the request is out. Leaving the
    // fields live would let the user keep typing into state the request never saw,
    // and then have success close the dialog and discard it.
    await waitFor(() => expect(nameField()).toBeDisabled())
    // Abandoning a slow save stays possible; that is what the guard makes safe.
    expect(screen.getByRole('button', { name: 'Close' })).toBeEnabled()

    d.resolve()
    await settle(d)
  })

  it('the shared mutation being busy elsewhere does not make an idle dialog claim it is saving', async () => {
    // The cross-talk this replaced: `saving` used to read
    // `addItem.isPending || editItem.isPending`, which an inline row edit BEHIND
    // the dialog also raises. Pinned by asserting the label with the shared flag
    // true and no save of the dialog's own outstanding.
    h.editItemPending.mockReturnValue(true)
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: 'Edit Tent' }))

    expect(screen.getByRole('button', { name: 'Save changes' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Saving…' })).not.toBeInTheDocument()
    expect(nameField()).toBeEnabled()
  })
})

describe('the inline new-category editor, concurrency', () => {
  it('will not submit twice while the first create is still out', async () => {
    // Category names are not unique in the schema, so an unguarded repeat - Enter
    // repeats on its own - quietly creates a second category.
    const d = deferred()
    h.createCategory.mockReturnValue(d.promise)
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: 'New category' }))
    const input = screen.getByPlaceholderText('Category name')
    fireEvent.change(input, { target: { value: 'Sleep system' } })

    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    // Neither route in gets through a second time: the button is disabled and shows
    // the pending label, and Enter is guarded on the same state.
    expect(await screen.findByRole('button', { name: 'Adding…' })).toBeDisabled()
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.click(screen.getByRole('button', { name: 'Adding…' }))

    expect(h.createCategory).toHaveBeenCalledTimes(1)
    d.resolve({ id: 'c-new', name: 'Sleep system', sortOrder: 0, createdAt: '' })
  })

  it('a create that answers after the editor was closed and reopened leaves the new session alone', async () => {
    // The editor carries a session id, and every transition is applied only if that
    // session is still the open one. Without it, attempt A's success would clear and
    // close the editor the user reopened for B - or A's failure would stamp its
    // error on it.
    const d = deferred()
    h.createCategory.mockReturnValueOnce(d.promise)
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: 'New category' }))
    fireEvent.change(screen.getByPlaceholderText('Category name'), { target: { value: 'A' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(h.createCategory).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByRole('button', { name: 'Cancel new category' }))
    fireEvent.click(screen.getByRole('button', { name: 'New category' }))
    fireEvent.change(screen.getByPlaceholderText('Category name'), { target: { value: 'B' } })

    d.reject(new Error('nope'))
    await settle(d)

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByPlaceholderText('Category name')).toHaveValue('B')
    // And the new session can still submit: the pending flag belonged to the old one.
    expect(screen.getByRole('button', { name: 'Add' })).toBeEnabled()
  })
})

describe('create list from selection', () => {
  it('reports a failure inside its own dialog, which stays open to retry', async () => {
    // This mutation is NOT optimistic - the case meta.errorToast exists for - but
    // its dialog stays open on failure, so the error goes beside the form. (The
    // toast it used to raise expired behind the backdrop, before toasts rendered
    // over modals, and the create failed silently.)
    h.createListFromSelection.mockRejectedValue(new Error('nope'))
    renderPage()

    await enterSelectMode()
    fireEvent.click(screen.getByRole('button', { name: 'Create list from selection' }))
    fireEvent.change(screen.getByLabelText(/^List name/), { target: { value: 'Winter kit' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create list' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't confirm the list was created. Refresh before retrying, in case it was.",
    )
    expect(screen.getByRole('dialog', { name: 'Create list from selection' })).toBeInTheDocument()
    expect(screen.getByLabelText(/^List name/)).toHaveValue('Winter kit')
  })
})

describe('sessions ended by something other than their own close button', () => {
  it('a category create that lands after another dialog opened does not close it', async () => {
    // The hole in the first attempt-token draft: the token was bumped only by the
    // editor's own Cancel, but EVERY other dialog on this page replaces the editor
    // by calling setDialog directly. Submit a category, open New item while it is
    // out, let it succeed - and the success closed the New item dialog. The editor
    // now carries a session id inside its own dialog variant, so a late answer's
    // decision is one guarded functional update against whatever is open NOW; it
    // does not have to be told about the routes out.
    const d = deferred()
    h.createCategory.mockReturnValue(d.promise)
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: 'New category' }))
    fireEvent.change(screen.getByPlaceholderText('Category name'), { target: { value: 'Sleep system' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(h.createCategory).toHaveBeenCalled())

    await openNewItemDialog()
    expect(screen.getByRole('dialog', { name: 'New item' })).toBeInTheDocument()

    d.resolve({ id: 'c-new', name: 'Sleep system', sortOrder: 0, createdAt: '' })
    await settle(d)

    expect(screen.getByRole('dialog', { name: 'New item' })).toBeInTheDocument()
  })

  it('and a failed one leaves the next editor session clean rather than stuck', async () => {
    // Holding `pending` inside the session is what makes this structural: a new
    // session cannot inherit a previous one's in-flight state, whatever happened to
    // the request that started it.
    const d = deferred()
    h.createCategory.mockReturnValue(d.promise)
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: 'New category' }))
    fireEvent.change(screen.getByPlaceholderText('Category name'), { target: { value: 'A' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(h.createCategory).toHaveBeenCalled())

    await openNewItemDialog()
    d.reject(new Error('nope'))
    await settle(d)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    fireEvent.click(screen.getByRole('button', { name: 'New category' }))
    fireEvent.change(screen.getByPlaceholderText('Category name'), { target: { value: 'B' } })

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add' })).toBeEnabled()
  })

  it('a create settling in the same tick as a QUEUED replacement keeps the replacement', async () => {
    // The replacement here is only queued, not committed: the CSV callbacks
    // run in a non-event context, so React schedules the import-error dialog
    // without flushing it, and the category create settles before the editor's
    // unmount commits. An unconditional close on success queues setDialog(null)
    // BEHIND the replacement and wipes it; the page's closeCategorySession
    // decides functionally against whatever is open now, queued included. The
    // tests above miss this window because they commit the replacement (or
    // unmount) before settling the create.
    const d = deferred()
    h.createCategory.mockReturnValue(d.promise)
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: 'New category' }))
    fireEvent.change(screen.getByPlaceholderText('Category name'), { target: { value: 'A' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(h.createCategory).toHaveBeenCalled())

    // Step OUTSIDE the act environment for the interleave: under act, a
    // non-event update commits synchronously, which unmounts the editor
    // before the create's continuation runs and closes the window this test
    // exists to hold open. With the real scheduler, the replacement is only
    // QUEUED (its commit is a later macrotask) while the continuation runs on
    // the microtask queue, exactly as in the browser.
    const g = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    const prevActEnv = g.IS_REACT_ACT_ENVIRONMENT
    g.IS_REACT_ACT_ENVIRONMENT = false
    try {
      csv.onError!('That file is not a gear CSV.')
      d.resolve({ id: 'c-new', name: 'A', sortOrder: 0, createdAt: '' })
      // Run the component's continuation (microtasks) before any commit.
      await d.promise
      await Promise.resolve()
      // Let the scheduler's deferred flush land.
      await new Promise((res) => setTimeout(res, 0))
    } finally {
      g.IS_REACT_ACT_ENVIRONMENT = prevActEnv
    }
    await act(async () => {})

    expect(screen.getByRole('dialog', { name: 'Import error' })).toBeInTheDocument()
    expect(screen.getByText('That file is not a gear CSV.')).toBeInTheDocument()
  })

  it('a create-list failure arriving after its dialog closed does not re-open it', async () => {
    const d = deferred()
    h.createListFromSelection.mockReturnValue(d.promise as Promise<unknown>)
    renderPage()

    await enterSelectMode()
    fireEvent.click(screen.getByRole('button', { name: 'Create list from selection' }))
    fireEvent.change(screen.getByLabelText(/^List name/), { target: { value: 'Winter kit' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create list' }))

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog', { name: 'Create list from selection' })).not.toBeInTheDocument()

    d.reject(new Error('nope'))
    await settle(d)

    expect(screen.queryByRole('dialog', { name: 'Create list from selection' })).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe("GearItemDialog's own create-category affordance", () => {
  it('reports a failed create inline, in the dialog, with create-safe advice', async () => {
    // The third surface `addCategory` is reached from, and it runs inside a modal
    // that stays open, so the error goes beside the form. It is also a POST, so its
    // copy has to match the other creates rather than say "try again".
    h.createCategory.mockRejectedValue(new Error('nope'))
    renderPage()

    await openNewItemDialog()
    fireEvent.change(screen.getByLabelText(/^Category/), {
      target: { value: '__new_category__' },
    })
    fireEvent.change(screen.getByPlaceholderText('Category name'), {
      target: { value: 'Sleep system' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create category' }))

    expect(await screen.findByText(
      "Couldn't confirm the category was created. Refresh before retrying, in case it was.",
    )).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'New item' })).toBeInTheDocument()
  })
})
