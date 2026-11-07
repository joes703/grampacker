// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { shimDialog } from './test/list-detail-harness'
import { ApiError } from '../lib/api'
import { CSV_HEADER_LINE, type ListCsvRow } from '../lib/csv'

// Pins the hook's one coordination duty: every route that OPENS one of its
// dialogs must fire onBeforeOpen first, so the page can close its own dialog
// union and the two state machines never both hold a surface. The parse
// callbacks are the obvious routes; the subtle one is a MUTATION rejection
// landing after the user dismissed the preview and opened another dialog -
// without onBeforeOpen there, the error modal stacks over (for example) a
// delete confirmation, and closing it reveals the stale destructive dialog.

const csv = vi.hoisted(() => ({
  onParsed: undefined as ((rows: ListCsvRow[], filename: string) => void) | undefined,
  onError: undefined as ((message: string) => void) | undefined,
  openPicker: vi.fn(),
}))
vi.mock('../lib/use-csv-file-input', () => ({
  useCsvFileInput: (
    _parse: unknown,
    handlers: {
      onParsed: (rows: ListCsvRow[], filename: string) => void
      onError: (message: string) => void
    },
  ) => {
    csv.onParsed = handlers.onParsed
    csv.onError = handlers.onError
    return { inputRef: { current: null }, onChange: vi.fn(), openPicker: csv.openPicker }
  },
}))

const mut = vi.hoisted(() => ({
  lastCallbacks: undefined as
    | { onSuccess?: () => void; onError?: (err: Error) => void }
    | undefined,
}))
vi.mock('./use-list-import-mutation', () => ({
  useListImportMutation: () => ({
    isPending: false,
    mutate: (_vars: unknown, cbs: typeof mut.lastCallbacks) => {
      mut.lastCallbacks = cbs
    },
  }),
}))

// Thin dialog stands-ins: this test is about WHEN the hook's dialogs open,
// not their rendering (ListImportPreviewDialog has its own test).
vi.mock('./ListImportPreviewDialog', () => ({
  default: (p: { onConfirm: (rows: ListCsvRow[]) => void; onClose: () => void }) => (
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

import { useListImportFlow } from './use-list-import-flow'

beforeAll(shimDialog)

function Harness({ onBeforeOpen }: { onBeforeOpen: () => void }) {
  const { openImportExplainer, importUi } = useListImportFlow({ onBeforeOpen })
  return (
    <>
      <button type="button" onClick={openImportExplainer}>open-explainer</button>
      {importUi}
    </>
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  mut.lastCallbacks = undefined
})

describe('useListImportFlow explainer', () => {
  it('shows the CSV row first and opens the file picker on Continue', () => {
    const onBeforeOpen = vi.fn()
    render(<Harness onBeforeOpen={onBeforeOpen} />)

    fireEvent.click(screen.getByText('open-explainer'))
    expect(onBeforeOpen).toHaveBeenCalledTimes(1)
    expect(screen.getByText(CSV_HEADER_LINE)).toBeInTheDocument()
    expect(csv.openPicker).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(csv.openPicker).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(CSV_HEADER_LINE)).toBeNull()
  })

  it('Cancel closes it without opening the file picker', () => {
    render(<Harness onBeforeOpen={vi.fn()} />)

    fireEvent.click(screen.getByText('open-explainer'))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(csv.openPicker).not.toHaveBeenCalled()
    expect(screen.queryByText(CSV_HEADER_LINE)).toBeNull()
  })
})

describe('useListImportFlow failed import', () => {
  it('asks the user to check before retrying when the outcome is unknown', () => {
    render(<Harness onBeforeOpen={vi.fn()} />)
    act(() => csv.onParsed!([], 'trip.csv'))
    fireEvent.click(screen.getByText('confirm-import'))
    act(() => mut.lastCallbacks!.onError!(new TypeError('Failed to fetch')))

    expect(
      screen.getByText(/Couldn't confirm the import\. Check your lists before trying again\./),
    ).toBeInTheDocument()
  })
})

describe('useListImportFlow onBeforeOpen', () => {
  it('fires before the parse result opens the preview or parse-error dialog', () => {
    const onBeforeOpen = vi.fn()
    render(<Harness onBeforeOpen={onBeforeOpen} />)

    act(() => csv.onParsed!([], 'trip.csv'))
    expect(screen.getByText('confirm-import')).toBeInTheDocument()
    expect(onBeforeOpen).toHaveBeenCalledTimes(1)

    act(() => csv.onError!('bad file'))
    expect(screen.getByText(/Import error: bad file/)).toBeInTheDocument()
    expect(onBeforeOpen).toHaveBeenCalledTimes(2)
  })

  it('fires again when a late import rejection opens the error dialog', () => {
    // The stacking sequence: confirm the import, dismiss the preview while
    // the POST is out, open another dialog on the page (represented by the
    // page's dialog union, which onBeforeOpen clears), then let the import
    // reject. The error dialog must close the page's dialog on its way in.
    const onBeforeOpen = vi.fn()
    render(<Harness onBeforeOpen={onBeforeOpen} />)

    act(() => csv.onParsed!([], 'trip.csv'))
    fireEvent.click(screen.getByText('confirm-import'))
    fireEvent.click(screen.getByText('close-preview'))
    expect(screen.queryByText('confirm-import')).toBeNull()
    expect(onBeforeOpen).toHaveBeenCalledTimes(1)

    act(() => mut.lastCallbacks!.onError!(new ApiError(422, 'boom')))
    expect(screen.getByText(/Import error: boom/)).toBeInTheDocument()
    expect(onBeforeOpen).toHaveBeenCalledTimes(2)
  })
})
