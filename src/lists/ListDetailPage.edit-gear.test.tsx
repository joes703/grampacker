// @vitest-environment jsdom
import { makeList, makeListItem } from '../test/fixtures'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import type { Category, GearItem } from '../lib/types'
import { renderListDetailPage, shimDialog, stubViewport } from './test/list-detail-harness'

// ListDetailPage's edit-gear dialog is a two-stage async save - gear first, then the
// per-list patch - and a dialog the user can dismiss at any point during it. Three
// reachable outcomes, not four: a failed gear write short-circuits, so "both failed"
// cannot happen. Its unit-level pieces are all elsewhere; what has no other home is
// the state machine that decides WHICH outcome lands on WHICH dialog.
//
// It is worth a page-level harness because the dialog is shared with GearLibraryPage
// and its two mutations are shared with the inline row writes behind it. Both of
// those sharings have already produced bugs: the mutations' `isPending` reported an
// unrelated row edit as this dialog saving, and unguarded completions could resurrect
// a dismissed dialog or close one the user opened since.

const listId = 'list-1'

const list = makeList({
  id: listId,
  name: 'Sierra High Route',
  isShared: false,
  updatedAt: '2026-07-01T00:00:00.000Z',
})

const category: Category = {
  id: 'c1',
  name: 'Shelter',
  sortOrder: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
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

const listItem = makeListItem({
  id: 'li-1',
  gearItemId: 'g1',
  gearItem: gear(),
  quantity: 1,
  isWorn: false,
  isConsumable: false,
  sortOrder: 0,
  packingLocationId: null,
})

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
  promise.catch(() => {})
  return { promise, resolve, reject }
}

// Wait for the page's continuation on a settled request and let React flush. See the
// identical helper in GearLibraryPage.save-errors.test.tsx for why a bare waitFor is
// not enough when the assertion is an absence.
async function settle(d: Deferred): Promise<void> {
  await act(async () => {
    await d.promise.catch(() => {})
  })
}

const h = vi.hoisted(() => ({
  fetchLists: vi.fn(),
  fetchListItems: vi.fn(),
  fetchGearItems: vi.fn(),
  fetchCategories: vi.fn(),
  fetchPackingLocations: vi.fn(),
  fetchListFood: vi.fn(),
  updateGearItem: vi.fn<(id: string, patch: unknown) => Promise<unknown>>(),
  updateListItem: vi.fn<(listId: string, itemId: string, patch: unknown) => Promise<unknown>>(),
}))

// Keeps better-auth's session atom from mounting (test/list-detail-harness.tsx
// explains why). The session is read here only for the last-list pointer's
// owner id, which no test in this file asserts on.
vi.mock('../lib/auth-client', () => ({
  authClient: { useSession: () => ({ data: { user: { id: 'owner-1' } }, isPending: false }) },
}))

vi.mock('../lib/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/queries')>()
  return { ...actual, ...h }
})

async function renderDetail() {
  await renderListDetailPage(`/lists/${listId}`, ['/lists/:id'])
  await screen.findByRole('button', { name: 'Item options' })
}

// The real row's kebab menu (the desktop row; the viewport is 1280px wide).
function chooseRowAction(name: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Item options' }))
  const menu = screen.getByRole('group', { name: 'Item actions' })
  fireEvent.click(within(menu).getByRole('button', { name }))
}

function openEditor() {
  chooseRowAction('Edit')
}

function nameField(): HTMLInputElement {
  return screen.getByLabelText(/^Name/) as HTMLInputElement
}

beforeAll(shimDialog)

beforeEach(() => {
  stubViewport(1280)
  h.fetchLists.mockResolvedValue([list])
  h.fetchListItems.mockResolvedValue([listItem])
  h.fetchGearItems.mockResolvedValue([gear()])
  h.fetchCategories.mockResolvedValue([category])
  h.fetchPackingLocations.mockResolvedValue([])
  h.fetchListFood.mockResolvedValue({ dayCount: 0, slots: [], items: [] })
  h.updateGearItem.mockResolvedValue(undefined)
  h.updateListItem.mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('the edit-gear dialog save', () => {
  it('reports an unconfirmed gear write inline, keeps the draft, and does not go on to the list write', async () => {
    const d = deferred()
    h.updateGearItem.mockReturnValue(d.promise)
    await renderDetail()
    openEditor()

    fireEvent.change(nameField(), { target: { value: 'Tarp' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    d.reject(new Error('offline'))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't confirm those gear changes saved. Try again, or refresh to check.",
    )
    expect(screen.getByRole('dialog', { name: 'Edit item' })).toBeInTheDocument()
    expect(nameField().value).toBe('Tarp')
    // Short-circuit: stage two never starts, which is why "both failed" is not a
    // reachable outcome. Note what this does NOT establish - a rejected request is
    // not proof the server did not commit, which is why the copy above says
    // "couldn't confirm" rather than "no changes were applied".
    expect(h.updateListItem).not.toHaveBeenCalled()
  })

  it('reports a partial save when the gear write lands and the list write does not', async () => {
    // The message differs from the one above because the DB state differs, and that
    // distinction is the whole reason this is a two-stage save rather than one call.
    const d = deferred()
    h.updateListItem.mockReturnValue(d.promise)
    await renderDetail()
    openEditor()

    fireEvent.change(screen.getByLabelText(/^Quantity/), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(h.updateGearItem).toHaveBeenCalled())
    d.reject(new Error('offline'))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Saved the gear changes, but couldn't confirm the update to this list item. Try again, or refresh to check.",
    )
    expect(screen.getByRole('dialog', { name: 'Edit item' })).toBeInTheDocument()
  })

  it('closes on a clean save', async () => {
    await renderDetail()
    openEditor()

    fireEvent.change(nameField(), { target: { value: 'Tarp' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Edit item' })).not.toBeInTheDocument(),
    )
  })

  it('a failure arriving after the user closed the dialog does not resurrect it', async () => {
    // The dialog stays dismissable while saving. Without the identity guard the
    // catch would re-open it - remounted, so blank, discarding the very draft the
    // error is inviting the user to retry.
    const d = deferred()
    h.updateGearItem.mockReturnValue(d.promise)
    await renderDetail()
    openEditor()

    fireEvent.change(nameField(), { target: { value: 'Tarp' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog', { name: 'Edit item' })).not.toBeInTheDocument()

    d.reject(new Error('offline'))
    await settle(d)

    expect(screen.queryByRole('dialog', { name: 'Edit item' })).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('a success arriving after the dialog was reopened does not close the new one', async () => {
    const d = deferred()
    h.updateGearItem.mockReturnValue(d.promise)
    await renderDetail()
    openEditor()

    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    openEditor()

    d.resolve()
    await settle(d)

    expect(screen.getByRole('dialog', { name: 'Edit item' })).toBeInTheDocument()
  })

  it('a gear write outstanding from elsewhere does not make this dialog claim it is saving', async () => {
    // `updateGearItem` and `updateListItem` are shared with the inline row handlers,
    // so `isPending` is not this dialog's business - and now that `saving` freezes
    // the form, reading it would disable a dialog the user is typing in for a write
    // that has nothing to do with it. The outstanding write here is the row's own
    // quick status change, still pending when the user opens the editor.
    const d = deferred()
    h.updateGearItem.mockReturnValue(d.promise)
    await renderDetail()

    chooseRowAction('Loaned out')
    await waitFor(() =>
      expect(h.updateGearItem).toHaveBeenCalledWith('g1', { status: 'loaned_out' }),
    )
    openEditor()

    expect(screen.getByRole('button', { name: 'Save changes' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Saving…' })).not.toBeInTheDocument()
    expect(nameField()).toBeEnabled()

    d.resolve()
    await settle(d)
  })
})
