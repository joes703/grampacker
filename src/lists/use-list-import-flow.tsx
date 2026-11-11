import { useState, type ReactNode } from 'react'
import { parseListCsv, nameFromCsvFilename, type ListCsvRow } from '../lib/csv'
import { importErrorMessage } from '../lib/import-error'
import { useCsvFileInput } from '../lib/use-csv-file-input'
import { useListImportMutation } from './use-list-import-mutation'
import ListImportPreviewDialog from './ListImportPreviewDialog'
import ConfirmDialog from '../components/ConfirmDialog'
import CsvHeaderLine from '../components/CsvHeaderLine'
import Modal from '../components/Modal'
import PrimaryButton from '../components/PrimaryButton'
import { SECONDARY_BUTTON } from '../components/flat-table-styles'

// The CSV-import-into-a-new-list flow: the explainer, hidden file input, parse
// wiring, the preview dialog, the import POST, and the error dialog - one path, used by
// ListsPage, DesktopListsPanel and ListsEmptyState. The underlying data path (plan/preflight/
// POST + invalidate/navigate) stays in useListImportMutation; this hook owns
// the SURFACE around it.
//
// The caller renders `importUi` anywhere in its tree and calls
// `openImportExplainer` from its own trigger. `onBeforeOpen` fires when this
// hook is about to open any of its dialogs, so a page can close its own
// transient dialog state first (the parse callback runs when a file read
// settles, not inside the page's dialog state machine).
export function useListImportFlow({ onBeforeOpen }: { onBeforeOpen?: () => void } = {}): {
  openImportExplainer: () => void
  importUi: ReactNode
} {
  const [state, setState] = useState<
    | { type: 'preview'; rows: ListCsvRow[]; filename: string }
    | { type: 'explainer' }
    | { type: 'error'; message: string }
    | null
  >(null)

  const importMut = useListImportMutation()

  const {
    inputRef: importInputRef,
    onChange: handleImportFile,
    openPicker: openImportPicker,
  } = useCsvFileInput<ListCsvRow>(parseListCsv, {
    onParsed: (rows, filename) => {
      onBeforeOpen?.()
      setState({ type: 'preview', rows, filename })
    },
    onError: (message) => {
      onBeforeOpen?.()
      setState({ type: 'error', message })
    },
  })

  const importUi = (
    <>
      <input
        ref={importInputRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={handleImportFile}
      />
      {state?.type === 'explainer' && (
        <Modal open onClose={() => setState(null)} title="Import list" className="w-full max-w-md">
          <div className="p-6">
            <h2 className="text-base font-semibold text-gray-900 mb-3">Import list</h2>
            <p className="text-sm text-gray-600 mb-3">
              Creates a new list with the same name as the file.
            </p>
            <CsvHeaderLine />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setState(null)} className={SECONDARY_BUTTON}>
                Cancel
              </button>
              <PrimaryButton
                type="button"
                onClick={() => {
                  setState(null)
                  openImportPicker()
                }}
              >
                Continue
              </PrimaryButton>
            </div>
          </div>
        </Modal>
      )}
      {state?.type === 'preview' && (
        <ListImportPreviewDialog
          rows={state.rows}
          saving={importMut.isPending}
          onConfirm={() =>
            importMut.mutate(
              { name: nameFromCsvFilename(state.filename), rows: state.rows },
              {
                onSuccess: () => setState(null),
                onError: (err) => {
                  // A rejection can land AFTER the user dismissed the preview
                  // and opened another dialog on the page, so this route
                  // opens a dialog too and must clear the page's own union
                  // first - otherwise the error modal stacks over (say) a
                  // delete confirmation, and closing it reveals the stale
                  // destructive dialog.
                  onBeforeOpen?.()
                  setState({
                    type: 'error',
                    message: importErrorMessage(err, 'lists'),
                  })
                },
              },
            )
          }
          onClose={() => setState(null)}
        />
      )}
      {state?.type === 'error' && (
        <ConfirmDialog
          title="Import error"
          message={state.message}
          messageTone="danger"
          confirmLabel="Close"
          cancel={false}
          onConfirm={() => setState(null)}
          onCancel={() => setState(null)}
        />
      )}
    </>
  )

  return {
    openImportExplainer: () => {
      onBeforeOpen?.()
      setState({ type: 'explainer' })
    },
    importUi,
  }
}
