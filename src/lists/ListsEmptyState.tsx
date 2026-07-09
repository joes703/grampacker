import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import { Plus, Upload } from 'lucide-react'
import {
  queryKeys,
  createList,
  makeOptimisticInsert,
} from '../lib/queries'
import type { List } from '../lib/types'
import { optimisticListPlaceholder } from '../lib/optimistic-list-placeholder'
import { useCsvFileInput } from '../lib/use-csv-file-input'
import { parseListCsv, nameFromCsvFilename, type ListCsvRow } from '../lib/csv'
import { useListImportMutation } from './use-list-import-mutation'
import ListImportPreviewDialog from './ListImportPreviewDialog'
import Modal from '../components/Modal'
import PrimaryButton from '../components/PrimaryButton'

// Empty state shown to a brand-new user when they have zero lists.
// Two paths: name-and-create a blank list, or import a CSV which creates
// a list and populates it in one go (mirrors the import button on the
// lists page header for users who already have lists).
export default function ListsEmptyState() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [importPreview, setImportPreview] = useState<{ rows: ListCsvRow[]; filename: string } | null>(null)
  const [importError, setImportError] = useState<string | null>(null)

  const {
    inputRef: importInputRef,
    onChange: handleImportFile,
    openPicker: openImportPicker,
  } = useCsvFileInput<ListCsvRow>(parseListCsv, {
    onParsed: (rows, filename) => setImportPreview({ rows, filename }),
    onError: (message) => setImportError(message),
  })

  // Shared import hook (plan/preflight/POST + invalidate/navigate); this
  // surface routes success/failure into its local dialog state.
  const importMut = useListImportMutation()

  const createMut = useMutation({
    mutationFn: (n: string) => createList(n),
    // sortOrder 0 is correct here: this empty state only renders when
    // lists.length === 0, where nextListSortOrder([]) === 0, so the new
    // list is the first one. The server assigns the same slot.
    ...makeOptimisticInsert<List, string>({
      qc,
      queryKey: queryKeys.lists(),
      optimistic: (n) => optimisticListPlaceholder({ name: n, sortOrder: 0 }),
    }),
    onSuccess: (list) => {
      void navigate(`/lists/${list.id}`)
    },
    // Local error state is set at the call site (submit) so it doesn't
    // override the helper's rollback onError. Both fire — useMutation's
    // helper-level onError first (rolls back cache), then the mutate()
    // call-site onError (sets the user-facing error message).
  })

  function submit() {
    const trimmed = name.trim()
    if (!trimmed || createMut.isPending) return
    setError(null)
    createMut.mutate(trimmed, {
      onError: (err) => {
        setError(err instanceof Error ? err.message : 'Could not create list. Try again.')
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
            className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <PrimaryButton
            onClick={submit}
            disabled={!name.trim() || createMut.isPending}
            className="gap-1.5"
          >
            <Plus size={14} /> Create
          </PrimaryButton>
        </div>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        <div className="mt-6 flex items-center gap-3 text-xs uppercase tracking-wide text-gray-400">
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

      <input
        ref={importInputRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={handleImportFile}
      />

      {importPreview && (
        <ListImportPreviewDialog
          rows={importPreview.rows}
          saving={importMut.isPending}
          onConfirm={() =>
            importMut.mutate(
              { name: nameFromCsvFilename(importPreview.filename), rows: importPreview.rows },
              {
                onSuccess: () => setImportPreview(null),
                onError: (err) => {
                  setImportPreview(null)
                  setImportError(err instanceof Error ? err.message : 'Could not import CSV. Try again.')
                },
              },
            )
          }
          onClose={() => setImportPreview(null)}
        />
      )}

      {importError && (
        <Modal open onClose={() => setImportError(null)} title="Import error" className="w-full max-w-sm">
          <div className="p-6">
            <h2 className="mb-2 text-base font-semibold text-gray-900">Import error</h2>
            <p className="mb-4 text-sm text-red-600">{importError}</p>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setImportError(null)}
                className="rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200"
              >
                Close
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
