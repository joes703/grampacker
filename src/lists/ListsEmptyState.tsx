import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import { Plus } from 'lucide-react'
import { useAuth } from '../auth/AuthProvider'
import { queryKeys, createList } from '../lib/queries'

export default function ListsEmptyState() {
  const { session } = useAuth()
  const userId = session!.user.id
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [name, setName] = useState('')

  const createMut = useMutation({
    mutationFn: (n: string) => createList(userId, n, 0),
    onSuccess: (list) => {
      qc.invalidateQueries({ queryKey: queryKeys.lists() })
      navigate(`/lists/${list.id}`)
    },
  })

  function submit() {
    const trimmed = name.trim()
    if (!trimmed || createMut.isPending) return
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
      </div>
    </div>
  )
}
