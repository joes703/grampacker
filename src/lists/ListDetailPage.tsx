import { useState } from 'react'
import { useParams, useNavigate } from 'react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, arrayMove, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { ArrowLeft, BookOpen, Share2, Table2 } from 'lucide-react'
import { useAuth } from '../auth/AuthProvider'
import {
  queryKeys,
  fetchLists,
  fetchListItems,
  fetchGearItems,
  fetchCategories,
  addGearItemToList,
  updateListItem,
  deleteListItem,
  updateList,
  reorderListItems,
} from '../lib/queries'
import type { GearItem, ListItemWithGear } from '../lib/types'
import ListItemRow from './ListItemRow'
import WeightTable from './WeightTable'
import LibraryPanel from './LibraryPanel'
import LibrarySheet from './LibrarySheet'

type Tab = 'items' | 'weight'

export default function ListDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  useAuth()
  const qc = useQueryClient()

  const [tab, setTab] = useState<Tab>('items')
  const [sheetOpen, setSheetOpen] = useState(false)

  const { data: lists = [] } = useQuery({ queryKey: queryKeys.lists(), queryFn: fetchLists })
  const list = lists.find((l) => l.id === id)

  const { data: listItems = [] } = useQuery({
    queryKey: queryKeys.listItems(id!),
    queryFn: () => fetchListItems(id!),
    enabled: Boolean(id),
  })

  const { data: gearItems = [] } = useQuery({
    queryKey: queryKeys.gearItems(),
    queryFn: fetchGearItems,
  })

  const { data: categories = [] } = useQuery({
    queryKey: queryKeys.categories(),
    queryFn: fetchCategories,
  })

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const addMut = useMutation({
    mutationFn: (item: GearItem) =>
      addGearItemToList(id!, { id: item.id, weight_grams: item.weight_grams }, listItems.length),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.listItems(id!) }),
  })

  const updateMut = useMutation({
    mutationFn: ({ itemId, patch }: { itemId: string; patch: Parameters<typeof updateListItem>[1] }) =>
      updateListItem(itemId, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.listItems(id!) }),
  })

  const deleteMut = useMutation({
    mutationFn: (itemId: string) => deleteListItem(itemId),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.listItems(id!) }),
  })

  const reorderMut = useMutation({
    mutationFn: (updates: { id: string; sort_order: number }[]) => reorderListItems(updates),
  })

  const shareToggleMut = useMutation({
    mutationFn: (shared: boolean) => updateList(id!, { is_shared: shared }),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.lists() }),
  })

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const oldIndex = listItems.findIndex((i) => i.id === active.id)
    const newIndex = listItems.findIndex((i) => i.id === over.id)
    const reordered = arrayMove(listItems, oldIndex, newIndex)
    qc.setQueryData(queryKeys.listItems(id!), reordered)
    reorderMut.mutate(reordered.map((item, idx) => ({ id: item.id, sort_order: idx })))
  }

  const listItemGearIds = new Set(
    listItems.filter((i) => i.gear_item_id !== null).map((i) => i.gear_item_id as string),
  )

  if (!list) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-gray-400">
        List not found.
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate('/lists')}
          className="rounded p-1 text-gray-400 hover:text-gray-700"
          aria-label="Back to lists"
        >
          <ArrowLeft size={18} />
        </button>
        <h1 className="flex-1 truncate text-xl font-semibold text-gray-900">{list.name}</h1>
        <button
          onClick={() => shareToggleMut.mutate(!list.is_shared)}
          title={list.is_shared ? `Sharing on — token: ${list.share_token}` : 'Enable sharing'}
          className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium ${
            list.is_shared
              ? 'border-green-300 bg-green-50 text-green-700 hover:bg-green-100'
              : 'border-gray-300 text-gray-600 hover:bg-gray-100'
          }`}
        >
          <Share2 size={14} />
          {list.is_shared ? list.share_token : 'Share'}
        </button>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-gray-200">
        <TabBtn active={tab === 'items'} onClick={() => setTab('items')}>
          <BookOpen size={14} /> Items
        </TabBtn>
        <TabBtn active={tab === 'weight'} onClick={() => setTab('weight')}>
          <Table2 size={14} /> Weight table
        </TabBtn>
      </div>

      {tab === 'items' && (
        <div className="flex gap-4">
          {/* List items column */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm text-gray-500">{listItems.length} items</p>
              {/* Mobile: open sheet */}
              <button
                onClick={() => setSheetOpen(true)}
                className="flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 lg:hidden"
              >
                <BookOpen size={14} /> Add from library
              </button>
            </div>

            {listItems.length === 0 ? (
              <div className="flex h-32 items-center justify-center rounded-xl border-2 border-dashed border-gray-200">
                <p className="text-sm text-gray-400">No items — add from your gear library</p>
              </div>
            ) : (
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext
                  items={listItems.map((i) => i.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="space-y-1">
                    {listItems.map((item) => (
                      <ListItemRow
                        key={item.id}
                        item={item}
                        onUpdate={(patch) => updateMut.mutate({ itemId: item.id, patch })}
                        onDelete={() => deleteMut.mutate(item.id)}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            )}
          </div>

          {/* Desktop library sidebar */}
          <div className="hidden lg:flex w-72 shrink-0 flex-col rounded-xl border border-gray-200 bg-white overflow-hidden" style={{ maxHeight: '70vh' }}>
            <div className="px-3 py-2 border-b border-gray-200">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Gear library</p>
            </div>
            <div className="flex-1 overflow-hidden">
              <LibraryPanel
                gearItems={gearItems}
                categories={categories}
                listItemGearIds={listItemGearIds}
                onAdd={(item) => addMut.mutate(item)}
              />
            </div>
          </div>
        </div>
      )}

      {tab === 'weight' && (
        <WeightTable items={listItems as ListItemWithGear[]} categories={categories} />
      )}

      {/* Mobile sheet */}
      <LibrarySheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        gearItems={gearItems}
        categories={categories}
        listItemGearIds={listItemGearIds}
        onAdd={(item) => { addMut.mutate(item); setSheetOpen(false) }}
      />
    </div>
  )
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-px ${
        active
          ? 'border-blue-600 text-blue-700'
          : 'border-transparent text-gray-500 hover:text-gray-700'
      }`}
    >
      {children}
    </button>
  )
}
