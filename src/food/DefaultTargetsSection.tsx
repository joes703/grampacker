import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthProvider'
import { queryKeys, fetchTargetDefaults, saveTargetDefaults, type DefaultsSavePayload } from '../lib/queries'
import DefaultTargetsDialog from './DefaultTargetsDialog'

export default function DefaultTargetsSection() {
  const { session } = useAuth()
  const userId = session?.user.id ?? ''
  if (!userId) return null
  // key=userId: an account switch remounts the whole panel (query + mutation +
  // editor state), so user A's in-flight save can never act on user B's editor.
  return <DefaultTargetsPanel key={userId} userId={userId} />
}

function DefaultTargetsPanel({ userId }: { userId: string }) {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)

  const { data: defaults, isLoading, isError, refetch } = useQuery({
    queryKey: queryKeys.targetDefaults(userId),
    queryFn: () => fetchTargetDefaults(userId),
  })

  const saveMut = useMutation({
    mutationFn: (payload: DefaultsSavePayload) => saveTargetDefaults(userId, payload),
    meta: { errorToast: "Couldn't save default targets. Please try again." },
    onSuccess: () => { setOpen(false); return qc.invalidateQueries({ queryKey: queryKeys.targetDefaults(userId) }) },
  })

  if (isLoading) return <p className="text-sm text-gray-500">Loading defaults...</p>
  // Surface read failures explicitly. Editing stays blocked (no Edit button) so a
  // failed load can never be mistaken for "no defaults" and overwritten.
  if (isError || !defaults) {
    return (
      <div className="space-y-2 text-sm">
        <p className="text-rose-600">Couldn't load your default targets.</p>
        <button type="button" onClick={() => { void refetch() }}
          className="rounded border border-gray-300 px-3 py-2 font-medium text-gray-700 hover:bg-gray-50">Retry</button>
      </div>
    )
  }

  const activeCount = defaults.length // every stored default is active (DB forbids 'off')
  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-600">
        {activeCount === 0
          ? 'No defaults set. New food plans start without targets.'
          : `${activeCount} of 6 daily targets set. Copied into each new food plan.`}
      </p>
      <button type="button" onClick={() => setOpen(true)}
        className="rounded border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
        Edit defaults
      </button>
      {open && (
        <DefaultTargetsDialog
          defaults={defaults}
          saving={saveMut.isPending}
          onSave={(p) => saveMut.mutate(p)}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  )
}
