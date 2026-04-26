import { useState, useRef } from 'react'
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
import { SortableContext, useSortable, arrayMove, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ArrowLeft, BookOpen, ChevronDown, ChevronRight, GripVertical, PackageCheck, RotateCcw, Share2, Upload, X } from 'lucide-react'
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
  reorderCategories,
  importCsvRowsToList,
} from '../lib/queries'
import type { GearItem, ListItemWithGear, Category } from '../lib/types'
import { parseListCsv, type ListImportRow } from '../lib/csv'
import { formatGrams } from '../lib/weight'
import ListItemRow from './ListItemRow'
import WeightTable from './WeightTable'
import LibraryPanel from './LibraryPanel'
import LibrarySheet from './LibrarySheet'

type Tab = 'items' | 'pack'

export default function ListDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { session } = useAuth()
  const userId = session!.user.id
  const qc = useQueryClient()

  const [tab, setTab] = useState<Tab>('items')
  const [sheetOpen, setSheetOpen] = useState(false)
  const [importPreview, setImportPreview] = useState<ListImportRow[] | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const importInputRef = useRef<HTMLInputElement>(null)

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

  // ── Mutations ──────────────────────────────────────────────────────────────

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

  const shareToggleMut = useMutation({
    mutationFn: (shared: boolean) => updateList(id!, { is_shared: shared }),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.lists() }),
  })

  const reorderCatsMut = useMutation({
    mutationFn: reorderCategories,
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.categories() }),
  })

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  function handleCategoryDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const sortedCats = [...categories].sort((a, b) => a.sort_order - b.sort_order)
    const oldIndex = sortedCats.findIndex((c) => c.id === active.id)
    const newIndex = sortedCats.findIndex((c) => c.id === over.id)
    if (oldIndex === -1 || newIndex === -1) return
    const reordered = arrayMove(sortedCats, oldIndex, newIndex)
    qc.setQueryData(queryKeys.categories(), reordered)
    reorderCatsMut.mutate(reordered.map((c, i) => ({ id: c.id, sort_order: i })))
  }

  const importMut = useMutation({
    mutationFn: (rows: ListImportRow[]) =>
      importCsvRowsToList(id!, userId, rows, gearItems, categories, listItems.length),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.listItems(id!) })
      qc.invalidateQueries({ queryKey: queryKeys.gearItems() })
      qc.invalidateQueries({ queryKey: queryKeys.categories() })
      setImportPreview(null)
    },
  })

  async function resetPacked() {
    await Promise.all(
      listItems.filter((i) => i.is_packed).map((i) => updateListItem(i.id, { is_packed: false })),
    )
    qc.invalidateQueries({ queryKey: queryKeys.listItems(id!) })
  }

  // ── CSV import ─────────────────────────────────────────────────────────────

  function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (importInputRef.current) importInputRef.current.value = ''
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = ev.target?.result as string
      const result = parseListCsv(text)
      if (typeof result === 'string') setImportError(result)
      else setImportPreview(result)
    }
    reader.readAsText(file)
  }

  // ── Derived data ───────────────────────────────────────────────────────────

  const listItemGearIds = new Set(
    listItems.filter((i) => i.gear_item_id !== null).map((i) => i.gear_item_id as string),
  )

  // Group list items by category (ordered by category sort_order)
  const catMap = new Map(categories.map((c) => [c.id, c]))
  const sortedCats = [...categories].sort((a, b) => a.sort_order - b.sort_order)

  type Group = { category: Category | null; items: ListItemWithGear[] }
  const grouped: Group[] = sortedCats
    .map((cat) => ({
      category: cat,
      items: listItems.filter((i) => i.gear_item?.category_id === cat.id),
    }))
    .filter((g) => g.items.length > 0)

  const uncategorisedItems = listItems.filter(
    (i) => !i.gear_item || i.gear_item.category_id === null || !catMap.has(i.gear_item.category_id),
  )
  if (uncategorisedItems.length > 0) grouped.push({ category: null, items: uncategorisedItems })

  // ── Loading / not found ────────────────────────────────────────────────────

  if (!list) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-gray-400">
        List not found.
      </div>
    )
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={() => navigate('/lists')}
          className="rounded p-1 text-gray-400 hover:text-gray-700"
          aria-label="Back to lists"
        >
          <ArrowLeft size={18} />
        </button>
        <h1 className="flex-1 truncate text-xl font-semibold text-gray-900">{list.name}</h1>

        {/* Import CSV */}
        <button
          onClick={() => importInputRef.current?.click()}
          title="Import list from CSV"
          className="flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-50"
        >
          <Upload size={14} /> Import
        </button>
        <input
          ref={importInputRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={handleImportFile}
        />

        {/* Share toggle */}
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
      <div className="flex items-center gap-1 border-b border-gray-200">
        <TabBtn active={tab === 'items'} onClick={() => setTab('items')}>
          <BookOpen size={14} /> Items
        </TabBtn>
        <TabBtn active={tab === 'pack'} onClick={() => setTab('pack')}>
          <PackageCheck size={14} /> Pack
        </TabBtn>
      </div>

      {/* ── Items tab ── */}
      {tab === 'items' && (
        <div className="flex gap-4">
          {/* Desktop library sidebar — LEFT */}
          <div
            className="hidden lg:flex w-72 shrink-0 flex-col rounded-xl border border-gray-200 bg-white overflow-hidden"
            style={{ maxHeight: '75vh' }}
          >
            <div className="px-3 py-2 border-b border-gray-200 bg-gray-50">
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

          {/* Right column: weight table + items */}
          <div className="flex-1 min-w-0 space-y-6">
            {/* Mobile: Add from library button */}
            <div className="lg:hidden">
              <button
                onClick={() => setSheetOpen(true)}
                className="flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100"
              >
                <BookOpen size={14} /> Add from library
              </button>
            </div>

            {/* Weight table — always visible above items */}
            {listItems.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                  Weight summary
                </p>
                <WeightTable items={listItems as ListItemWithGear[]} categories={categories} />
              </div>
            )}

            {/* Items grouped by category — real categories sortable, uncategorised pinned at end */}
            {listItems.length === 0 ? (
              <div className="flex h-32 items-center justify-center rounded-xl border-2 border-dashed border-gray-200">
                <p className="text-sm text-gray-400">No items — add from your gear library</p>
              </div>
            ) : (
              <div className="space-y-4">
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleCategoryDragEnd}>
                  <SortableContext
                    items={grouped.filter((g) => g.category !== null).map((g) => g.category!.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    {grouped
                      .filter((g) => g.category !== null)
                      .map((group) => (
                        <SortableListCategoryGroup
                          key={group.category!.id}
                          id={group.category!.id}
                          name={group.category!.name}
                          items={group.items}
                          onUpdate={(itemId, patch) => updateMut.mutate({ itemId, patch })}
                          onDelete={(itemId) => deleteMut.mutate(itemId)}
                        />
                      ))}
                  </SortableContext>
                </DndContext>
                {grouped
                  .filter((g) => g.category === null)
                  .map((group) => (
                    <ListCategoryGroup
                      key="__uncategorised__"
                      name="Uncategorised"
                      items={group.items}
                      onUpdate={(itemId, patch) => updateMut.mutate({ itemId, patch })}
                      onDelete={(itemId) => deleteMut.mutate(itemId)}
                    />
                  ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Pack tab ── */}
      {tab === 'pack' && (
        <PackingView
          items={listItems}
          grouped={grouped}
          onToggle={(itemId, packed) => updateMut.mutate({ itemId, patch: { is_packed: packed } })}
          onReset={resetPacked}
        />
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

      {/* Import error */}
      {importError && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-lg">
            <h2 className="text-base font-semibold text-gray-900 mb-2">Import error</h2>
            <p className="text-sm text-red-600 mb-4">{importError}</p>
            <div className="flex justify-end">
              <button
                onClick={() => setImportError(null)}
                className="rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Import preview */}
      {importPreview && (
        <ImportPreviewDialog
          rows={importPreview}
          saving={importMut.isPending}
          onConfirm={() => importMut.mutate(importPreview)}
          onClose={() => setImportPreview(null)}
        />
      )}
    </div>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────────────

type GroupProps = {
  name: string
  items: ListItemWithGear[]
  onUpdate: (itemId: string, patch: Parameters<typeof updateListItem>[1]) => void
  onDelete: (itemId: string) => void
  dragHandle?: React.ReactNode
}

function ListCategoryGroup({ name, items, onUpdate, onDelete, dragHandle }: GroupProps) {
  const [collapsed, setCollapsed] = useState(false)

  return (
    <div>
      <div className="flex items-center gap-1 rounded-lg px-2 py-1.5 bg-gray-100 mb-1">
        {dragHandle}
        <button
          onClick={() => setCollapsed((v) => !v)}
          className="flex flex-1 items-center gap-1.5 text-left"
        >
          {collapsed ? (
            <ChevronRight size={14} className="text-gray-400 shrink-0" />
          ) : (
            <ChevronDown size={14} className="text-gray-400 shrink-0" />
          )}
          <span className="flex-1 text-sm font-medium text-gray-700">{name}</span>
          <span className="text-xs text-gray-400">{items.length}</span>
        </button>
      </div>
      {!collapsed && (
        <div className="space-y-0.5 pl-2">
          {items.map((item) => (
            <ListItemRow
              key={item.id}
              item={item}
              onUpdate={(patch) => onUpdate(item.id, patch)}
              onDelete={() => onDelete(item.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function SortableListCategoryGroup(props: GroupProps & { id: string }) {
  const { id, ...rest } = props
  const {
    attributes,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id })

  const handle = (
    <button
      ref={setActivatorNodeRef as unknown as (node: HTMLButtonElement | null) => void}
      {...listeners}
      {...attributes}
      className="cursor-grab touch-none text-gray-400 hover:text-gray-600 active:cursor-grabbing shrink-0"
      tabIndex={-1}
      aria-label="Drag to reorder category"
    >
      <GripVertical size={14} />
    </button>
  )

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}
    >
      <ListCategoryGroup {...rest} dragHandle={handle} />
    </div>
  )
}

function PackingView({
  items,
  grouped,
  onToggle,
  onReset,
}: {
  items: ListItemWithGear[]
  grouped: { category: { name: string; id: string } | null; items: ListItemWithGear[] }[]
  onToggle: (itemId: string, packed: boolean) => void
  onReset: () => void
}) {
  const total = items.length
  const packed = items.filter((i) => i.is_packed).length
  const pct = total === 0 ? 0 : Math.round((packed / total) * 100)
  const done = packed === total && total > 0

  return (
    <div className="space-y-4">
      {/* Progress bar */}
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-gray-700">
            {packed} / {total} packed
          </span>
          <div className="flex items-center gap-2">
            {done && (
              <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                All packed!
              </span>
            )}
            <button
              onClick={onReset}
              disabled={packed === 0}
              className="flex items-center gap-1 rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 disabled:opacity-40"
            >
              <RotateCcw size={12} /> Reset
            </button>
          </div>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200">
          <div
            className={`h-2 rounded-full transition-all ${done ? 'bg-green-500' : 'bg-blue-500'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* Items by category */}
      {grouped.map((group) => (
        <div key={group.category?.id ?? '__uncategorised__'}>
          <p className="mb-1.5 px-1 text-xs font-semibold uppercase tracking-wide text-gray-400">
            {group.category?.name ?? 'Uncategorised'}
          </p>
          <div className="space-y-1">
            {group.items.map((item) => {
              const name = item.gear_item?.name ?? '(deleted item)'
              const label = item.quantity > 1 ? `${name} ×${item.quantity}` : name
              return (
                <label
                  key={item.id}
                  className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-sm transition-colors ${
                    item.is_packed
                      ? 'border-green-200 bg-green-50'
                      : 'border-gray-100 bg-white hover:bg-gray-50'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={item.is_packed}
                    onChange={(e) => onToggle(item.id, e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-blue-600"
                  />
                  <span
                    className={`flex-1 min-w-0 truncate ${
                      item.is_packed ? 'text-gray-400 line-through' : 'text-gray-800'
                    }`}
                  >
                    {label}
                  </span>
                  <span className="shrink-0 tabular-nums text-xs text-gray-400">
                    {formatGrams(item.weight_grams * item.quantity)}
                  </span>
                </label>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

function ImportPreviewDialog({
  rows,
  saving,
  onConfirm,
  onClose,
}: {
  rows: ListImportRow[]
  saving: boolean
  onConfirm: () => void
  onClose: () => void
}) {
  const wornCount = rows.filter((r) => r.is_worn).length
  const consumCount = rows.filter((r) => r.is_consumable).length

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-lg rounded-xl bg-white shadow-lg flex flex-col max-h-[80vh]">
        <div className="flex items-center justify-between px-6 pt-5 pb-3 border-b border-gray-100">
          <div>
            <h2 className="text-base font-semibold text-gray-900">
              Import {rows.length} item{rows.length !== 1 ? 's' : ''} to list
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              New items will be added to your gear library. Items already in the library won't be duplicated.
              {wornCount > 0 && ` ${wornCount} worn.`}
              {consumCount > 0 && ` ${consumCount} consumable.`}
            </p>
          </div>
          <button onClick={onClose} className="ml-4 text-gray-400 hover:text-gray-600">
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-gray-50 text-xs font-medium text-gray-500">
              <tr>
                <th className="px-4 py-2 text-left">Name</th>
                <th className="px-3 py-2 text-right">Weight</th>
                <th className="px-3 py-2 text-left">Category</th>
                <th className="px-3 py-2 text-center">Flags</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rows.map((row, i) => (
                <tr key={i} className="hover:bg-gray-50">
                  <td className="px-4 py-1.5 font-medium text-gray-800 max-w-[160px] truncate">{row.name}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-gray-600">{formatGrams(row.weight_grams)}</td>
                  <td className="px-3 py-1.5 text-gray-500">{row.category || '—'}</td>
                  <td className="px-3 py-1.5 text-center text-xs">
                    {row.is_worn && <span className="text-purple-600 mr-1">W</span>}
                    {row.is_consumable && <span className="text-orange-600">C</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-gray-100">
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={saving}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? 'Importing…' : `Import ${rows.length} item${rows.length !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
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
