// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GearCsvRow } from '../lib/csv'

// Pins the hook's one coordination duty, same as the list flow's test
// (src/lists/use-list-import-flow.test.tsx): every route that OPENS one of
// its dialogs must fire onBeforeOpen first, so the page can close its own
// dialog union and the two state machines never both hold a surface. The
// gear flow has one more route than the list one - the explainer entry -
// because before the split, "Import CSV" replaced whatever page dialog was
// open through the shared union.

const csv = vi.hoisted(() => ({
  onParsed: undefined as ((rows: GearCsvRow[], filename: string) => void) | undefined,
  onError: undefined as ((message: string) => void) | undefined,
}))
vi.mock('../lib/use-csv-file-input', () => ({
  useCsvFileInput: (
    _parse: unknown,
    handlers: {
      onParsed: (rows: GearCsvRow[], filename: string) => void
      onError: (message: string) => void
    },
  ) => {
    csv.onParsed = handlers.onParsed
    csv.onError = handlers.onError
    return { inputRef: { current: null }, onChange: vi.fn(), openPicker: vi.fn() }
  },
}))

const api = vi.hoisted(() => ({
  importGearItems: vi.fn(),
}))
vi.mock('../lib/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/queries')>()
  return { ...actual, importGearItems: api.importGearItems }
})

// The planner is not under test; it just has to want a POST so the
// mutation's error route is reachable.
vi.mock('../lib/csv/import-plan', () => ({
  planGearImport: () => ({ newItems: [{ name: 'Stove' }], newCategories: [] }),
  assertGearImportWithinCaps: () => {},
}))

// Thin dialog stands-ins: this test is about WHEN the hook's dialogs open,
// not their rendering.
vi.mock('../components/Modal', () => ({
  default: (p: { children: React.ReactNode }) => <div>{p.children}</div>,
}))
vi.mock('../components/ImportPreviewDialog', () => ({
  default: (p: { onConfirm: (rows: GearCsvRow[]) => void; onClose: () => void }) => (
    <div>
      <button type="button" onClick={() => p.onConfirm([])}>confirm-import</button>
      <button type="button" onClick={p.onClose}>close-preview</button>
    </div>
  ),
}))
vi.mock('../components/ConfirmDialog', () => ({
  default: (p: { title: string; message: string }) => (
    <div>{`${p.title}: ${p.message}`}</div>
  ),
}))

import { useGearImportFlow } from './use-gear-import-flow'
import { deferred } from '../test/deferred'

function Harness({ onBeforeOpen }: { onBeforeOpen: () => void }) {
  const { openImportExplainer, importUi } = useGearImportFlow({
    categories: [],
    allItems: [],
    onBeforeOpen,
  })
  return (
    <>
      <button type="button" onClick={openImportExplainer}>open-explainer</button>
      {importUi}
    </>
  )
}

function renderHarness(onBeforeOpen: () => void) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <Harness onBeforeOpen={onBeforeOpen} />
    </QueryClientProvider>,
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('useGearImportFlow onBeforeOpen', () => {
  it('fires when the explainer opens, and when a parse result opens a dialog', () => {
    const onBeforeOpen = vi.fn()
    renderHarness(onBeforeOpen)

    fireEvent.click(screen.getByText('open-explainer'))
    expect(screen.getByText('Import gear inventory')).toBeInTheDocument()
    expect(onBeforeOpen).toHaveBeenCalledTimes(1)

    act(() => csv.onParsed!([], 'gear.csv'))
    expect(screen.getByText('confirm-import')).toBeInTheDocument()
    expect(onBeforeOpen).toHaveBeenCalledTimes(2)

    act(() => csv.onError!('bad file'))
    expect(screen.getByText(/Import error: bad file/)).toBeInTheDocument()
    expect(onBeforeOpen).toHaveBeenCalledTimes(3)
  })

  it('fires again when a late import rejection opens the error dialog', async () => {
    // The stacking sequence: confirm the import, dismiss the preview while
    // the POST is out, open another dialog on the page, then let the import
    // reject. The error dialog must close the page's dialog on its way in.
    const importCall = deferred()
    api.importGearItems.mockImplementation(() => importCall.promise)
    const onBeforeOpen = vi.fn()
    renderHarness(onBeforeOpen)

    act(() => csv.onParsed!([], 'gear.csv'))
    fireEvent.click(screen.getByText('confirm-import'))
    // Let the mutation start (TanStack runs mutationFn on a microtask) so
    // the deferred rejection below has something to reject.
    await act(async () => {})
    expect(api.importGearItems).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByText('close-preview'))
    expect(screen.queryByText('confirm-import')).toBeNull()
    expect(onBeforeOpen).toHaveBeenCalledTimes(1)

    await act(async () => importCall.reject(new Error('boom')))
    expect(await screen.findByText(/Import error: boom/)).toBeInTheDocument()
    expect(onBeforeOpen).toHaveBeenCalledTimes(2)
  })
})
