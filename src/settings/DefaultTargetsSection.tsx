import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  fetchTargetDefaults,
  queryKeys,
  saveTargetDefaults,
} from '../lib/queries'
import { ApiError } from '../lib/api'
import DefaultTargetsDialog from '../food/DefaultTargetsDialog'
import type { SaveTargetDefaultsRequest } from '../../shared/food-plans'

// Settings body for account-level default daily targets (design 14.3). The
// save is a full replace returning the fresh set, written straight back into
// the only cache that derives from defaults - plans copy them by value at
// create time, server-side, so nothing else invalidates.
//
// No key={userId} remount machinery (the old build had it for same-tab
// account switches): sign-out here is a hard reload
// (window.location.assign), which dumps the query cache wholesale.
export default function DefaultTargetsSection() {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)

  const {
    data: defaults,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: queryKeys.targetDefaults(),
    queryFn: fetchTargetDefaults,
  })

  const saveMut = useMutation({
    mutationFn: (payload: SaveTargetDefaultsRequest) => saveTargetDefaults(payload),
    onSuccess: (fresh) => {
      qc.setQueryData(queryKeys.targetDefaults(), fresh)
      setOpen(false)
    },
  })

  if (isLoading) {
    return <p className="text-sm text-gray-500">Loading defaults…</p>
  }
  // Surface read failures explicitly. Editing stays blocked (no Edit button)
  // so a failed load can never be mistaken for "no defaults" and overwritten
  // by an empty full-replace save.
  if (isError || !defaults) {
    return (
      <div className="space-y-2 text-sm">
        <p className="text-rose-600">Couldn&apos;t load your default targets.</p>
        <button
          type="button"
          onClick={() => {
            void refetch()
          }}
          className="rounded border border-gray-300 px-3 py-2 font-medium text-gray-700 hover:bg-gray-50"
        >
          Retry
        </button>
      </div>
    )
  }

  const saveError = saveMut.error
    ? saveMut.error instanceof ApiError
      ? saveMut.error.message
      : 'Something went wrong. Please try again.'
    : null

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-600">
        {defaults.length === 0
          ? 'No defaults set. New food plans start without targets.'
          : `${defaults.length} of 6 daily targets set.`}
      </p>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
      >
        Edit defaults
      </button>
      {open && (
        <DefaultTargetsDialog
          defaults={defaults}
          saving={saveMut.isPending}
          saveError={saveError}
          onSave={(p) => saveMut.mutate(p)}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  )
}
