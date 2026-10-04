// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router'
import type { ReactNode } from 'react'
import type { List } from '../lib/types'
import { MobilePrimaryNavProvider } from '../layout/mobile-primary-nav-context'
import { SidebarDrawerProvider } from '../layout/sidebar-drawer-context'
import { showToast } from '../lib/toast'

// Notes can be long, and the editor is the only copy of what the user typed.
// So a save that fails must leave the editor open with the text in it, and
// say so. The page owns the mutation and NotesEditor owns the draft, so only
// a page-level test sees both halves.

const listId = 'list-1'

const list = {
  id: listId,
  name: 'Sierra High Route',
  description: 'Old notes',
  isShared: false,
  shareSlug: null,
  updatedAt: '2026-07-01T00:00:00.000Z',
} as unknown as List

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
  updateList: vi.fn<(id: string, patch: unknown) => Promise<unknown>>(),
}))

// See ListDetailPage.edit-gear.test.tsx: a real better-auth session atom
// outlives the jsdom environment and fails CI after the tests pass.
vi.mock('../lib/auth-client', () => ({
  authClient: { useSession: () => ({ data: { user: { id: 'owner-1' } }, isPending: false }) },
}))

vi.mock('../lib/toast', () => ({ showToast: vi.fn() }))

vi.mock('../lib/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/queries')>()
  return { ...actual, ...h }
})

function stubViewport(width: number) {
  vi.stubGlobal('matchMedia', (query: string) => {
    const m = /width\s*<\s*([\d.]+)rem/.exec(query)
    return {
      matches: m ? width < Number(m[1]) * 16 : false,
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

async function openNotesEditor(): Promise<HTMLTextAreaElement> {
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
  fireEvent.click(await screen.findByRole('button', { name: 'Edit notes' }))
  return screen.getByPlaceholderText(/Add notes about this packing list/) as HTMLTextAreaElement
}

beforeEach(() => {
  stubViewport(1280)
  h.fetchLists.mockResolvedValue([list])
  h.fetchListItems.mockResolvedValue([])
  h.fetchGearItems.mockResolvedValue([])
  h.fetchCategories.mockResolvedValue([])
  h.fetchPackingLocations.mockResolvedValue([])
  h.fetchListFood.mockResolvedValue({ dayCount: 0, slots: [], items: [] })
  h.updateList.mockResolvedValue(list)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('saving list notes', () => {
  it('keeps the editor open with the typed text, and says so, when the save fails', async () => {
    const d = deferred()
    h.updateList.mockReturnValue(d.promise)
    const textarea = await openNotesEditor()

    fireEvent.change(textarea, { target: { value: 'Permit pickup at Lone Pine' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    d.reject(new Error('offline'))
    await settle(d)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't confirm your notes were saved. Please try again.",
    )
    expect(screen.getByPlaceholderText(/Add notes about this packing list/)).toHaveValue(
      'Permit pickup at Lone Pine',
    )
  })

  it('closes the editor only once the save is confirmed', async () => {
    const d = deferred()
    h.updateList.mockReturnValue(d.promise)
    const textarea = await openNotesEditor()

    fireEvent.change(textarea, { target: { value: 'Permit pickup at Lone Pine' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(textarea).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()

    d.resolve({ ...list, description: 'Permit pickup at Lone Pine' })
    await settle(d)

    expect(screen.queryByPlaceholderText(/Add notes about this packing list/)).toBeNull()
    expect(h.updateList).toHaveBeenCalledWith(listId, { description: 'Permit pickup at Lone Pine' })
  })

  it('keeps text typed while the save was in flight', async () => {
    const d = deferred()
    h.updateList.mockReturnValue(d.promise)
    const textarea = await openNotesEditor()

    fireEvent.change(textarea, { target: { value: 'Permit pickup at Lone Pine' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    fireEvent.change(textarea, { target: { value: 'Permit pickup at Lone Pine, before 10 am' } })
    d.resolve({ ...list, description: 'Permit pickup at Lone Pine' })
    await settle(d)

    expect(screen.getByPlaceholderText(/Add notes about this packing list/)).toHaveValue(
      'Permit pickup at Lone Pine, before 10 am',
    )
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
  })

  it('reports by toast when the user canceled before the save failed', async () => {
    const d = deferred()
    h.updateList.mockReturnValue(d.promise)
    const textarea = await openNotesEditor()

    fireEvent.change(textarea, { target: { value: 'Permit pickup at Lone Pine' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    d.reject(new Error('offline'))
    await settle(d)

    expect(showToast).toHaveBeenCalledWith(
      "Couldn't confirm your notes were saved. Please try again.",
      { type: 'error' },
    )
    expect(screen.queryByPlaceholderText(/Add notes about this packing list/)).toBeNull()
  })

  it('does not reopen the editor until a canceled save has settled', async () => {
    // A second save would take over the first one's callbacks, and the
    // first one's failure would go unreported.
    const d = deferred()
    h.updateList.mockReturnValue(d.promise)
    const textarea = await openNotesEditor()

    fireEvent.change(textarea, { target: { value: 'Permit pickup at Lone Pine' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.getByRole('button', { name: 'Edit notes' })).toBeDisabled()

    d.reject(new Error('offline'))
    await settle(d)

    expect(screen.getByRole('button', { name: 'Edit notes' })).toBeEnabled()
  })
})
