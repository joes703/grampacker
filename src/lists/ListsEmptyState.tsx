import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import { Plus, Upload } from 'lucide-react'
import { useAuth } from '../auth/AuthProvider'
import {
  queryKeys,
  createList,
  fetchGearItems,
  fetchCategories,
  importCsvRowsToList,
} from '../lib/queries'
import { useCsvFileInput } from '../lib/use-csv-file-input'
import { parseListCsv, nameFromCsvFilename, type ListImportRow } from '../lib/csv'
import ListImportPreviewDialog from './ListImportPreviewDialog'
import Modal from '../components/Modal'

// Empty state shown to a brand-new user when they have zero lists.
// Two paths: name-and-create a blank list, or import a CSV which creates
// a list and populates it in one go (mirrors the import button on the
// lists box for users who already have lists).
export default function ListsEmptyState() {
  const { session } = useAuth()
  const userId = session!.user.id
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [importPreview, setImportPreview] = useState<{ rows: ListImportRow[]; filename: string } | null>(null)
  const [importError, setImportError] = useState<string | null>(null)

  // Gear/categories are needed by importCsvRowsToList to dedupe by name.
  // For a brand-new user both queries will return empty arrays; that's fine.
  const { data: gearItems = [] } = useQuery({
    queryKey: queryKeys.gearItems(),
    queryFn: () => fetchGearItems(userId),
  })
  const { data: categories = [] } = useQuery({
    queryKey: queryKeys.categories(),
    queryFn: () => fetchCategories(userId),
  })

  const {
    inputRef: importInputRef,
    onChange: handleImportFile,
    openPicker: openImportPicker,
  } = useCsvFileInput<ListImportRow>(
    parseListCsv,
    {
      onParsed: (rows, filename) => setImportPreview({ rows, filename }),
      onError: (message) => setImportError(message),
    },
  )

  const createMut = useMutation({
    mutationFn: (n: string) => createList(userId, n, 0),
    onSuccess: (list) => {
      qc.invalidateQueries({ queryKey: queryKeys.lists() })
      navigate(`/lists/${list.id}`)
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : 'Could not create list. Try again.')
    },
  })

  // Same shape as ListDetailInner's importMut: createList then populate,
  // navigate to the new list on success.
  const importMut = useMutation({
    mutationFn: async ({ name, rows }: { name: string; rows: ListImportRow[] }) => {
      const newList = await createList(userId, name, 0)
      await importCsvRowsToList(newList.id, userId, rows, gearItems, categories, 0)
      return newList
    },
    onSuccess: (newList) => {
      qc.invalidateQueries({ queryKey: queryKeys.lists() })
      qc.invalidateQueries({ queryKey: queryKeys.gearItems() })
      qc.invalidateQueries({ queryKey: queryKeys.categories() })
      setImportPreview(null)
      navigate(`/lists/${newList.id}`)
    },
    onError: (err) => {
      setImportPreview(null)
      setImportError(err instanceof Error ? err.message : 'Could not import CSV. Try again.')
    },
  })

  function submit() {
    const trimmed = name.trim()
    if (!trimmed || createMut.isPending) return
    setError(null)
    createMut.mutate(trimmed)
  }

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="w-full max-w-md text-center">
        <h2 className="text-xl font-semibold text-gray-900">Create your first list</h2>
        <p className="mt-2 text-sm text-gray-500">
          Lists let you build packs from your gear library and track total weight.
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
          <button
            onClick={submit}
            disabled={!name.trim() || createMut.isPending}
            className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            <Plus size={14} /> Create
          </button>
        </div>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        <div className="mt-6 flex items-center gap-3 text-xs uppercase tracking-wide text-gray-400">
          <span className="flex-1 border-t border-gray-200" />
          or
          <span className="flex-1 border-t border-gray-200" />
        </div>

        <button
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
          onConfirm={() => importMut.mutate({
            name: nameFromCsvFilename(importPreview.filename),
            rows: importPreview.rows,
          })}
          onClose={() => setImportPreview(null)}
        />
      )}

      {importError && (
        <Modal open onClose={() => setImportError(null)} title="Import error" className="w-full max-w-sm">
          <div className="p-6">
            <h2 className="text-base font-semibold text-gray-900 mb-2">Import error</h2>
            <p className="text-sm text-red-600 mb-4">{importError}</p>
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
