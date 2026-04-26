import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, arrayMove, rectSortingStrategy } from '@dnd-kit/sortable'
import { Plus } from 'lucide-react'
import { useAuth } from '../auth/AuthProvider'
import {
  queryKeys,
  fetchLists,
  createList,
  updateList,
  deleteList,
  duplicateList,
  reorderLists,
} from '../lib/queries'
import type { List } from '../lib/types'
import ListCard from './ListCard'
import ConfirmDialog from '../components/ConfirmDialog'

export default function ListIndexPage() {
  const { session } = useAuth()
  const userId = session!.user.id
  const qc = useQueryClient()
  const navigate = useNavigate()

  const [confirmDelete, setConfirmDelete] = useState<List | null>(null)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')

  const { data: lists = [] } = useQuery({
    queryKey: queryKeys.lists(),
    queryFn: fetchLists,
  })

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const createMut = useMutation({
    mutationFn: (name: string) => createList(userId, name, lists.length),
    onSuccess: (list) => {
      qc.invalidateQueries({ queryKey: queryKeys.lists() })
      navigate(`/lists/${list.id}`)
    },
  })

  const renameMut = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => updateList(id, { name }),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.lists() }),
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteList(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.lists() }),
  })

  const duplicateMut = useMutation({
    mutationFn: (list: List) => duplicateList(list, userId, lists.length),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.lists() }),
  })

  const reorderMut = useMutation({
    mutationFn: (updates: { id: string; sort_order: number }[]) => reorderLists(updates),
  })

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const oldIndex = lists.findIndex((l) => l.id === active.id)
    const newIndex = lists.findIndex((l) => l.id === over.id)
    const reordered = arrayMove(lists, oldIndex, newIndex)
    qc.setQueryData(queryKeys.lists(), reordered)
    reorderMut.mutate(reordered.map((l, i) => ({ id: l.id, sort_order: i })))
  }

  function submitCreate() {
    const trimmed = newName.trim()
    if (!trimmed) return
    setCreating(false)
    setNewName('')
    createMut.mutate(trimmed)
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-gray-900">My lists</h1>
        <button
          onClick={() => setCreating(true)}
          className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
        >
          <Plus size={15} /> New list
        </button>
      </div>

      {/* New list inline input */}
      {creating && (
        <div className="mb-4 flex gap-2">
          <input
            autoFocus
            type="text"
            placeholder="List name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitCreate()
              if (e.key === 'Escape') { setCreating(false); setNewName('') }
            }}
            className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={submitCreate}
            disabled={!newName.trim()}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Create
          </button>
          <button
            onClick={() => { setCreating(false); setNewName('') }}
            className="rounded-lg px-3 py-2 text-sm text-gray-600 hover:bg-gray-100"
          >
            Cancel
          </button>
        </div>
      )}

      {lists.length === 0 && !creating ? (
        <div className="flex h-48 items-center justify-center rounded-xl border-2 border-dashed border-gray-200">
          <p className="text-sm text-gray-400">No lists yet — create one to get started</p>
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={lists.map((l) => l.id)} strategy={rectSortingStrategy}>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {lists.map((list) => (
                <ListCard
                  key={list.id}
                  list={list}
                  onOpen={() => navigate(`/lists/${list.id}`)}
                  onRename={(name) => renameMut.mutate({ id: list.id, name })}
                  onDuplicate={() => duplicateMut.mutate(list)}
                  onDelete={() => setConfirmDelete(list)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {confirmDelete && (
        <ConfirmDialog
          title="Delete list"
          message={`Delete "${confirmDelete.name}"? This cannot be undone.`}
          dangerous
          onConfirm={() => {
            deleteMut.mutate(confirmDelete.id)
            setConfirmDelete(null)
          }}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  )
}
