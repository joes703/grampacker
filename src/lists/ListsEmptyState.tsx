import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import { Plus } from 'lucide-react'
import {
  queryKeys,
  createList,
  makeOptimisticInsert,
} from '../lib/queries'
import type { List } from '../lib/types'
import { optimisticListPlaceholder } from '../lib/optimistic-list-placeholder'
import PrimaryButton from '../components/PrimaryButton'

// Empty state shown to a brand-new user when they have zero lists.
//
// TRANSPLANT NOTE (csv): the old repo offered a second path here - import
// a CSV which creates and populates a list in one go (useCsvFileInput,
// ListImportPreviewDialog, importListFromCsv, the "or" divider and Import
// CSV button). That returns with the CSV slice.
export default function ListsEmptyState() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)

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
      </div>
    </div>
  )
}
