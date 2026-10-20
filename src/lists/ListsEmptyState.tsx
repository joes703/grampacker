import { useState } from 'react'
import { Plus, Upload } from 'lucide-react'
import { FORM_INPUT } from '../components/flat-table-styles'
import { useCurrentListActions, CREATE_FAILED_COPY } from './use-current-list-actions'
import { useListImportFlow } from './use-list-import-flow'
import PrimaryButton from '../components/PrimaryButton'

export { CREATE_FAILED_COPY }

// Empty state shown to a brand-new user when they have zero lists.
// Two paths: name-and-create a blank list, or import a CSV which creates
// a list and populates it in one go (mirrors the import button on the
// lists page header for users who already have lists).
export default function ListsEmptyState() {
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)

  // The whole CSV import surface (hidden input, preview, error dialog) in
  // one shared hook; the data path inside it invalidates and navigates.
  const { openImportPicker, importUi } = useListImportFlow()

  // THE create path - the same optimistic placeholder, append-slot snapshot
  // and navigate-on-success every other surface uses. This surface used to
  // hand-roll its own mutation under the same mutation key with a different
  // variables shape. The placeholder's failure feedback is the hook's toast:
  // the placeholder makes lists.length 1, ListsPage stops rendering the
  // empty state, and the component holding the inline error - and the
  // call-site onError below - is gone before the rejection arrives. The
  // call-site onError still fires while the component is mounted, so the
  // inline copy stays for that case; the toast is what survives the unmount.
  const { createListMut, submitCreateList } = useCurrentListActions()

  function submit() {
    const trimmed = name.trim()
    if (!trimmed || createListMut.isPending) return
    setError(null)
    submitCreateList(trimmed, {
      onError: (err) => {
        setError(err instanceof Error ? err.message : CREATE_FAILED_COPY)
      },
    })
  }

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="w-full max-w-md text-center">
        <h2 className="text-xl font-semibold text-gray-900">Create your first list</h2>
        <p className="mt-2 text-sm text-gray-500">
          Lists let you build packing lists from your gear library and track total weight.
        </p>
        <div className="mt-6 flex gap-2">
          <input
            autoFocus
            type="text"
            placeholder="e.g. PCT thru-hike"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
            className={`flex-1 ${FORM_INPUT}`}
          />
          <PrimaryButton
            onClick={submit}
            disabled={!name.trim() || createListMut.isPending}
            className="gap-1.5"
          >
            <Plus size={14} /> Create
          </PrimaryButton>
        </div>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        {/* Same 12px "or" divider as SignInPage, same 2.60:1 -> 4.84:1 fix.
            Lighthouse only ever saw the sign-in one (it cannot log in), but this
            is the same element failing the same floor. */}
        <div className="mt-6 flex items-center gap-3 text-xs uppercase tracking-wide text-gray-500">
          <span className="flex-1 border-t border-gray-200" />
          or
          <span className="flex-1 border-t border-gray-200" />
        </div>

        <button
          type="button"
          onClick={openImportPicker}
          className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          <Upload size={14} /> Import CSV
        </button>
        <p className="mt-2 text-xs text-gray-500">
          Lighterpack format works. The list is named from the file.
        </p>
      </div>

      {importUi}
    </div>
  )
}
