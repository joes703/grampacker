import { useState, type ReactNode } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys, importGearItems } from '../lib/queries'
import { mutationKeys } from '../lib/queries/keys'
import { parseGearCsv, type GearCsvRow } from '../lib/csv'
import { assertGearImportWithinCaps, planGearImport } from '../lib/csv/import-plan'
import { useCsvFileInput } from '../lib/use-csv-file-input'
import type { Category, GearItem } from '../lib/types'
import ImportPreviewDialog from '../components/ImportPreviewDialog'
import ConfirmDialog from '../components/ConfirmDialog'
import Modal from '../components/Modal'
import PrimaryButton from '../components/PrimaryButton'
import { SECONDARY_BUTTON } from '../components/flat-table-styles'

// The CSV-import-into-the-library flow: the explainer, hidden file input,
// parse wiring, the preview dialog, the import POST and the error dialog -
// the gear sibling of src/lists/use-list-import-flow.tsx, shaped the same
// way. The caller renders `importUi` anywhere in its tree and calls
// `openImportExplainer` from its own triggers.
//
// `onBeforeOpen` fires whenever this hook is about to open one of its own
// dialogs, so the page can close its own dialog union first and the two
// state machines never both hold a surface. The entry point counts too:
// before the split, "Import CSV" replaced whatever page dialog was open
// (the inline category editor included) through the shared union, and the
// explainer must keep doing that from its own state.
export function useGearImportFlow({
  categories,
  allItems,
  onBeforeOpen,
}: {
  categories: Category[]
  allItems: GearItem[]
  onBeforeOpen?: () => void
}): {
  openImportExplainer: () => void
  importUi: ReactNode
} {
  const qc = useQueryClient()
  const [state, setState] = useState<
    | { type: 'explainer' }
    | { type: 'preview'; rows: GearCsvRow[] }
    | { type: 'error'; message: string }
    | null
  >(null)

  const {
    inputRef: importInputRef,
    onChange: handleImportFile,
    openPicker: openImportPicker,
  } = useCsvFileInput<GearCsvRow>(parseGearCsv, {
    onParsed: (rows) => {
      onBeforeOpen?.()
      setState({ type: 'preview', rows })
    },
    onError: (message) => {
      onBeforeOpen?.()
      setState({ type: 'error', message })
    },
  })

  // Confirmed import: plan against the current library snapshot (dedup +
  // category resolution, see src/lib/csv/import-plan.ts), then one POST -
  // the server creates categories + items atomically. Rows that all match
  // existing gear plan to zero new items; skip the POST (the endpoint
  // rejects empty imports) and just close.
  const importItems = useMutation({
    mutationKey: mutationKeys.importGearItems(),
    mutationFn: async (rows: GearCsvRow[]) => {
      const plan = planGearImport(rows, categories, allItems)
      if (plan.newItems.length === 0) return
      // Preflight BOTH caps (gear and categories) against existing + new,
      // like the list import always did - the thrown message lands in the
      // import-error dialog with a specific fix instead of the server's
      // generic cap answer.
      assertGearImportWithinCaps(plan, allItems.length, categories.length)
      await importGearItems({ categories: plan.newCategories, items: plan.newItems })
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.categories() })
      void qc.invalidateQueries({ queryKey: queryKeys.gearItems() })
      setState(null)
    },
    // Surface failures (e.g. the 500-item cap) in the existing import-error
    // dialog instead of leaving the preview open with no feedback. A
    // rejection can land after the user dismissed the preview and opened
    // another dialog on the page, so this route opens a dialog too and must
    // clear the page's union first (the same late-rejection stacking the
    // list flow guards against).
    onError: (err) => {
      onBeforeOpen?.()
      setState({
        type: 'error',
        message: err instanceof Error ? err.message : 'Could not import CSV. Try again.',
      })
    },
  })

  const importUi = (
    <>
      {/* Mounted at the page level so it's always reachable via
          importInputRef.current.click(), even while the explainer dialog is
          unmounting. */}
      <input
        ref={importInputRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={handleImportFile}
      />
      {state?.type === 'explainer' && (
        <Modal open onClose={() => setState(null)} title="Import gear inventory" className="w-full max-w-md">
          <div className="p-6">
            <h2 className="text-base font-semibold text-gray-900 mb-3">Import gear inventory</h2>
            <p className="text-sm text-gray-600 mb-3">
              Adds gear directly to your library without creating a list. Useful for importing an existing inventory of gear you own.
            </p>
            <p className="text-sm text-gray-600 mb-5">
              Quantity, worn, and consumable settings from the CSV are ignored. Those apply to list items, not the inventory itself.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setState(null)}
                className={SECONDARY_BUTTON}
              >
                Cancel
              </button>
              <PrimaryButton
                type="button"
                onClick={() => { setState(null); openImportPicker() }}
              >
                Continue
              </PrimaryButton>
            </div>
          </div>
        </Modal>
      )}
      {state?.type === 'preview' && (
        <ImportPreviewDialog
          rows={state.rows}
          saving={importItems.isPending}
          onConfirm={(rows) => importItems.mutate(rows)}
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
