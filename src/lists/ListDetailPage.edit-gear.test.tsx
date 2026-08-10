// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router'
import type { ReactNode } from 'react'
import type { Category, GearItem, List, ListItemWithGear } from '../lib/types'
import { MobilePrimaryNavProvider } from '../layout/mobile-primary-nav-context'
import { SidebarDrawerProvider } from '../layout/sidebar-drawer-context'

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

const list = {
  id: listId,
  name: 'Sierra High Route',
  isShared: false,
  shareSlug: null,
  notes: null,
  readyChecksEnabled: true,
  updatedAt: '2026-07-01T00:00:00.000Z',
} as unknown as List

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

const listItem = {
  id: 'li-1',
  gearItemId: 'g1',
  gearItem: gear(),
  quantity: 1,
  isWorn: false,
  isConsumable: false,
  sortOrder: 0,
  packingLocationId: null,
} as unknown as ListItemWithGear

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

// The page calls authClient.useSession(), which mounts better-auth's nanostores
// session atom. Nanostores keeps an unmounted store alive on a ~1s timer, and
// when that timer fires AFTER vitest has torn down this file's jsdom
// environment, better-auth's cleanupBroadcastSetup touches `window` and throws
// an unhandled ReferenceError - failing CI with every test still passing.
// Mocking the client means the atom never mounts. The session is read here only
// for the last-list pointer's owner id, which no test in this file asserts on.
vi.mock('../lib/auth-client', () => ({
  authClient: { useSession: () => ({ data: { user: { id: 'owner-1' } }, isPending: false }) },
}))

vi.mock('../lib/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/queries')>()
  return { ...actual, ...h }
})

// The row surface reduced to its one entry point here. Driving the real kebab would
// test the kebab; the subject is what the page does after Save.
vi.mock('./CategoryGroup', () => ({
  default: (props: { items: ListItemWithGear[]; onEditGearItem: (gearId: string) => void }) => (
    <div>
      {props.items.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => props.onEditGearItem(item.gearItem.id)}
        >
          {`Edit ${item.gearItem.name}`}
        </button>
      ))}
    </div>
  ),
}))

function stubViewport(width: number) {
  vi.stubGlobal('matchMedia', (query: string) => {
    const m = /max-width:\s*([\d.]+)px/.exec(query)
    return {
      matches: m ? width <= Number(m[1]) : false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }
  })
}

function Providers({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return (
    <QueryClientProvider client={qc}>
      <MobilePrimaryNavProvider>
        <SidebarDrawerProvider>{children}</SidebarDrawerProvider>
      </MobilePrimaryNavProvider>
    </QueryClientProvider>
  )
}

async function renderDetail() {
  const { default: ListDetailPage } = await import('./ListDetailPage')
  render(
    <Providers>
      <MemoryRouter initialEntries={[`/lists/${listId}`]}>
        <Routes>
          <Route path="/lists/:id" element={<ListDetailPage />} />
        </Routes>
      </MemoryRouter>
    </Providers>,
  )
  return screen.findByRole('button', { name: 'Edit Tent' })
}

function nameField(): HTMLInputElement {
  return screen.getByLabelText(/^Name/) as HTMLInputElement
}

beforeAll(() => {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function () { this.open = true }
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function () { this.open = false }
  }
})

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
    fireEvent.click(await renderDetail())

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
    fireEvent.click(await renderDetail())

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
    fireEvent.click(await renderDetail())

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
    fireEvent.click(await renderDetail())

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
    fireEvent.click(await renderDetail())

    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    fireEvent.click(screen.getByRole('button', { name: 'Edit Tent' }))

    d.resolve()
    await settle(d)

    expect(screen.getByRole('dialog', { name: 'Edit item' })).toBeInTheDocument()
  })

  it('a gear write outstanding from elsewhere does not make this dialog claim it is saving', async () => {
    // `updateGearItem` and `updateListItem` are shared with the inline row handlers,
    // so `isPending` is not this dialog's business - and now that `saving` freezes
    // the form, reading it would disable a dialog the user is typing in for a write
    // that has nothing to do with it.
    //
    // The outstanding write here is an ABANDONED earlier save rather than a row edit,
    // because the row surface is stubbed in this file. Same mutation, same shared
    // `isPending`, so it pins the isolation - it does not additionally prove the row
    // handlers' wiring.
    const d = deferred()
    h.updateGearItem.mockReturnValue(d.promise)
    fireEvent.click(await renderDetail())

    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    fireEvent.click(screen.getByRole('button', { name: 'Edit Tent' }))

    expect(screen.getByRole('button', { name: 'Save changes' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Saving…' })).not.toBeInTheDocument()
    expect(nameField()).toBeEnabled()

    d.resolve()
    await settle(d)
  })
})
