import { useState, useRef, useEffect } from 'react'
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
import { createPortal } from 'react-dom'
import {
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Copy,
  Shirt,
  UtensilsCrossed,
  XCircle,
  Globe,
  GripVertical,
  Lock,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RotateCcw,
  X,
} from 'lucide-react'
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
  deleteList,
  createList,
  duplicateList,
  reorderCategories,
  reorderLists,
  reorderListItems,
  importCsvRowsToList,
  updateGearItem,
  createGearItem,
  deleteGearItem,
  makeOptimisticReorder,
  type ListItemPatch,
} from '../lib/queries'
import type { GearItem, ListItemWithGear, Category, List } from '../lib/types'
import { parseListCsv, listItemsToCsv, downloadCsv, type ListImportRow } from '../lib/csv'
import { formatItemWeight, getWeightUnit, setWeightUnit, type WeightUnit } from '../lib/weight'
import { getLastListId, setLastListId } from '../lib/preferences'
import { asButtonRef } from '../lib/dnd'
import { useCsvFileInput } from '../lib/use-csv-file-input'
import ListItemRow from './ListItemRow'
import WeightTable from './WeightTable'
import LibraryPanel from './LibraryPanel'
import LibrarySheet from './LibrarySheet'
import ListsBox from './ListsBox'
import ListsEmptyState from './ListsEmptyState'
import TypedConfirmDialog from '../components/TypedConfirmDialog'

type Mode = 'edit' | 'pack'

type AddItemData = {
  name: string
  description: string | null
  weight_grams: number
  quantity: number
  is_worn: boolean
  is_consumable: boolean
}

export default function ListDetailPage() {
  const { id: routeId } = useParams<{ id?: string }>()
  const navigate = useNavigate()
  const { session } = useAuth()
  const userId = session!.user.id
  const qc = useQueryClient()

  const { data: lists = [], isLoading: listsLoading } = useQuery({
    queryKey: queryKeys.lists(),
    queryFn: fetchLists,
  })

  // Lists ordered by most recently updated (for redirect target + post-delete fallback)
  const listsByRecent = [...lists].sort(
    (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
  )

  // Pick the redirect target: last list the user viewed (if it still exists), else most-recently-updated
  const lastViewedId = getLastListId()
  const lastViewed = lastViewedId ? lists.find((l) => l.id === lastViewedId) : null
  const fallbackList = lastViewed ?? listsByRecent[0]

  // Redirect /lists → /lists/<target> when no route id is present
  useEffect(() => {
    if (listsLoading) return
    if (!routeId && fallbackList) navigate(`/lists/${fallbackList.id}`, { replace: true })
  }, [routeId, fallbackList, listsLoading, navigate])

  // Remember the currently viewed list so we can return to it next visit
  useEffect(() => {
    if (routeId) setLastListId(routeId)
  }, [routeId])

  // No id and no lists → empty state
  if (!routeId && !listsLoading && lists.length === 0) {
    return <ListsEmptyState />
  }

  // No id and still resolving → render nothing while redirect runs
  if (!routeId) return null

  // key={routeId} forces a fresh ListDetailInner instance per list, so local
  // state (open dialogs, draft inputs, sidebar collapse, etc.) doesn't leak
  // when the user switches lists.
  return <ListDetailInner key={routeId} listId={routeId} lists={lists} listsByRecent={listsByRecent} userId={userId} qc={qc} navigate={navigate} />
}

function ListDetailInner({
  listId,
  lists,
  listsByRecent,
  userId,
  qc,
  navigate,
}: {
  listId: string
  lists: List[]
  listsByRecent: List[]
  userId: string
  qc: ReturnType<typeof useQueryClient>
  navigate: ReturnType<typeof useNavigate>
}) {
  const [mode, setMode] = useState<Mode>('edit')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [weightUnit, setWeightUnitState] = useState<WeightUnit>(getWeightUnit)

  function toggleWeightUnit() {
    const next: WeightUnit = weightUnit === 'g' ? 'oz' : 'g'
    setWeightUnit(next)
    setWeightUnitState(next)
  }
  const [sheetOpen, setSheetOpen] = useState(false)
  const [importPreview, setImportPreview] = useState<ListImportRow[] | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [confirmDeleteList, setConfirmDeleteList] = useState<List | null>(null)
  const [pendingImportId, setPendingImportId] = useState<string | null>(null)
  const [creatingList, setCreatingList] = useState(false)
  const [newListDraft, setNewListDraft] = useState('')
  const {
    inputRef: importInputRef,
    onChange: handleImportFile,
    openPicker: openImportPicker,
  } = useCsvFileInput<ListImportRow>(
    parseListCsv,
    { onParsed: setImportPreview, onError: setImportError },
  )

  const list = lists.find((l) => l.id === listId)

  // After navigating to a list because the user clicked Import on it from the menu,
  // open the file picker once we land on that list.
  useEffect(() => {
    if (pendingImportId && pendingImportId === listId) {
      setPendingImportId(null)
      openImportPicker()
    }
  }, [pendingImportId, listId, openImportPicker])

  const { data: listItems = [] } = useQuery({
    queryKey: queryKeys.listItems(listId),
    queryFn: () => fetchListItems(listId),
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
      addGearItemToList(listId, item.id, listItems.length),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.listItems(listId) }),
  })

  const updateMut = useMutation({
    mutationFn: ({ itemId, patch }: { itemId: string; patch: ListItemPatch }) =>
      updateListItem(itemId, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.listItems(listId) }),
  })

  const deleteMut = useMutation({
    mutationFn: (itemId: string) => deleteListItem(itemId),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.listItems(listId) }),
  })

  const reorderCatsMut = useMutation({
    mutationFn: reorderCategories,
    ...makeOptimisticReorder<Category>(qc, queryKeys.categories()),
  })

  const importMut = useMutation({
    mutationFn: (rows: ListImportRow[]) =>
      importCsvRowsToList(listId, userId, rows, gearItems, categories, listItems.length),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.listItems(listId) })
      qc.invalidateQueries({ queryKey: queryKeys.gearItems() })
      qc.invalidateQueries({ queryKey: queryKeys.categories() })
      setImportPreview(null)
    },
  })

  const duplicateMut = useMutation({
    mutationFn: (target: List) => duplicateList(target, userId, lists.length),
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: queryKeys.lists() })
      navigate(`/lists/${created.id}`)
    },
  })

  const reorderListsMut = useMutation({
    mutationFn: reorderLists,
    ...makeOptimisticReorder<List>(qc, queryKeys.lists()),
  })

  const reorderItemsMut = useMutation({
    mutationFn: reorderListItems,
    ...makeOptimisticReorder<ListItemWithGear>(qc, queryKeys.listItems(listId)),
  })

  const notesMut = useMutation({
    mutationFn: (description: string) => updateList(listId, { description: description || null }),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.lists() }),
  })

  // Editing an item's name/description from the list view writes to gear_items so
  // it propagates to the gear library and any other list that uses the same item.
  const updateGearItemMut = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Parameters<typeof updateGearItem>[1] }) =>
      updateGearItem(id, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.gearItems() })
      // Invalidate every list-items cache (any list that embeds this gear item)
      qc.invalidateQueries({ queryKey: ['list-items'] })
    },
  })

  // Delete a gear item entirely (from the gear library and every list that uses it).
  // gear_items.id is referenced by list_items with ON DELETE SET NULL on gear_item_id,
  // so existing list_items survive but render as "(deleted item)" until removed.
  const deleteGearItemMut = useMutation({
    mutationFn: (id: string) => deleteGearItem(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.gearItems() })
      qc.invalidateQueries({ queryKey: ['list-items'] })
    },
  })

  // "+ Add new item" inside a category — creates a gear_item (so it lives in the
  // gear library too), then adds it to this list under the same category. The
  // draft row in ListCategoryGroup collects all the fields up front.
  const addNewItemMut = useMutation({
    mutationFn: async ({ categoryId, data }: { categoryId: string | null; data: AddItemData }) => {
      const newGear = await createGearItem(
        userId,
        { name: data.name, description: data.description, weight_grams: data.weight_grams, category_id: categoryId },
        gearItems.length,
      )
      await addGearItemToList(listId, newGear.id, listItems.length, {
        quantity: data.quantity,
        is_worn: data.is_worn,
        is_consumable: data.is_consumable,
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.gearItems() })
      qc.invalidateQueries({ queryKey: queryKeys.listItems(listId) })
    },
  })

  const renameMut = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => updateList(id, { name }),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.lists() }),
  })

  const deleteListMut = useMutation({
    mutationFn: (id: string) => deleteList(id),
    onSuccess: async (_data, deletedId) => {
      await qc.invalidateQueries({ queryKey: queryKeys.lists() })
      // Switch to the next list (most recent remaining), or empty state
      const remaining = listsByRecent.filter((l) => l.id !== deletedId)
      if (remaining.length > 0) navigate(`/lists/${remaining[0].id}`, { replace: true })
      else navigate('/lists', { replace: true })
    },
  })

  const createListMut = useMutation({
    mutationFn: (name: string) => createList(userId, name, lists.length),
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: queryKeys.lists() })
      setCreatingList(false)
      setNewListDraft('')
      navigate(`/lists/${created.id}`)
    },
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
    reorderCatsMut.mutate(reordered.map((c, i) => ({ id: c.id, sort_order: i })))
  }

  // Reorder list items within a single category by re-using the existing
  // sort_order slots from the moved subset (avoids renumbering the whole list).
  // The optimistic cache update + rollback is handled by the mutation itself.
  function handleItemsReorder(reorderedItems: ListItemWithGear[]) {
    const slots = reorderedItems.map((i) => i.sort_order).slice().sort((a, b) => a - b)
    const updates = reorderedItems.map((i, idx) => ({ id: i.id, sort_order: slots[idx] }))
    reorderItemsMut.mutate(updates)
  }

  async function resetPacked() {
    await Promise.all(
      listItems.filter((i) => i.is_packed).map((i) => updateListItem(i.id, { is_packed: false })),
    )
    qc.invalidateQueries({ queryKey: queryKeys.listItems(listId) })
  }


  // ── Derived data ───────────────────────────────────────────────────────────

  const listItemGearIds = new Set(
    listItems.filter((i) => i.gear_item_id !== null).map((i) => i.gear_item_id as string),
  )

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

  // ── Not found ──────────────────────────────────────────────────────────────

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
      <div className="flex items-center gap-3">
        <button
          onClick={() => setSidebarOpen((v) => !v)}
          title={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
          className="hidden lg:inline-flex rounded p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100"
        >
          {sidebarOpen ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
        </button>
        <InlineTitle
          key={list.id}
          name={list.name}
          onSave={(v) => renameMut.mutate({ id: list.id, name: v })}
        />

        {/* g/oz toggle */}
        <button
          onClick={toggleWeightUnit}
          title={`Switch to ${weightUnit === 'g' ? 'oz' : 'g'}`}
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-50"
        >
          {weightUnit}
        </button>

        {/* Pack-mode toggle (icon) */}
        <button
          onClick={() => setMode(mode === 'pack' ? 'edit' : 'pack')}
          title={mode === 'pack' ? 'Pack mode: on' : 'Pack mode: off'}
          aria-pressed={mode === 'pack'}
          className={`inline-flex items-center justify-center rounded-lg border p-1.5 ${
            mode === 'pack'
              ? 'border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100'
              : 'border-gray-300 text-gray-500 hover:bg-gray-50'
          }`}
        >
          <ClipboardList size={16} />
        </button>

        {/* Privacy toggle (icon + popover) */}
        <PrivacyButton list={list} />
      </div>

      {/* Hidden file input — triggered by per-list Import menu action */}
      <input
        ref={importInputRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={handleImportFile}
      />

      {/* Two-column grid (sidebar can be collapsed) */}
      <div className="flex gap-4 items-start">
        {/* LEFT column — Lists box (always visible) + Library panel (collapsible). Hidden when sidebar is closed on desktop. */}
        {sidebarOpen && (
          <aside
            className="hidden lg:flex w-72 shrink-0 flex-col gap-4 sticky self-start"
            style={{ top: '1rem', height: 'calc(100vh - 2rem)' }}
          >
            <ListsBox
              lists={lists}
              activeId={list.id}
              creating={creatingList}
              newDraft={newListDraft}
              onNewDraftChange={setNewListDraft}
              onStartNew={() => setCreatingList(true)}
              onSubmitNew={() => {
                const trimmed = newListDraft.trim()
                if (trimmed) createListMut.mutate(trimmed)
                else { setCreatingList(false); setNewListDraft('') }
              }}
              onCancelNew={() => { setCreatingList(false); setNewListDraft('') }}
              onSelect={(l) => navigate(`/lists/${l.id}`)}
              onRename={(l, name) => renameMut.mutate({ id: l.id, name })}
              onImport={(l) => {
                if (l.id === list.id) openImportPicker()
                else { setPendingImportId(l.id); navigate(`/lists/${l.id}`) }
              }}
              onExport={async (l) => {
                const items = await qc.fetchQuery({
                  queryKey: queryKeys.listItems(l.id),
                  queryFn: () => fetchListItems(l.id),
                })
                const csv = listItemsToCsv(items as ListItemWithGear[], categories)
                downloadCsv(`${l.name.replace(/[^a-z0-9]/gi, '-').toLowerCase() || 'list'}.csv`, csv)
              }}
              onDuplicate={(l) => duplicateMut.mutate(l)}
              onDelete={(l) => setConfirmDeleteList(l)}
              onReorder={(orderedIds) => {
                reorderListsMut.mutate(orderedIds.map((id, i) => ({ id, sort_order: i })))
              }}
            />

            {/* Library panel */}
            <div className="flex flex-col rounded-xl border border-gray-200 bg-white overflow-hidden min-h-0 flex-1">
              <div className="px-3 py-2 border-b border-gray-200 bg-gray-50">
                <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Gear library
                </span>
              </div>
              <div className="flex-1 overflow-hidden">
                <LibraryPanel
                    gearItems={gearItems}
                    categories={categories}
                    listItemGearIds={listItemGearIds}
                    weightUnit={weightUnit}
                    onAdd={(item) => addMut.mutate(item)}
                    onRemove={(item) => {
                      const li = listItems.find((l) => l.gear_item_id === item.id)
                      if (li) deleteMut.mutate(li.id)
                    }}
                    onDelete={(item) => deleteGearItemMut.mutate(item.id)}
                  />
              </div>
            </div>
          </aside>
        )}

        {/* RIGHT column — weight table + items (always visible; packing checkbox column appears in pack mode) */}
        <div className="flex-1 min-w-0 space-y-4">
          {/* Mobile: Add from library button */}
          <div className="lg:hidden">
            <button
              onClick={() => setSheetOpen(true)}
              className="flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100"
            >
              <BookOpen size={14} /> Add from library
            </button>
          </div>

          {/* Pack-mode progress bar */}
          {mode === 'pack' && listItems.length > 0 && (
            <PackingProgress
              total={listItems.length}
              packed={listItems.filter((i) => i.is_packed).length}
              onReset={resetPacked}
            />
          )}

          {/* Notes + Weight summary — side by side, equal halves */}
          <div className={`grid gap-4 ${listItems.length > 0 ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-1'}`}>
            <PanelCard title="Notes">
              <NotesEditor
                key={list.id}
                initial={list.description ?? ''}
                onSave={(v) => notesMut.mutate(v)}
              />
            </PanelCard>
            {listItems.length > 0 && (
              <PanelCard title="Weight summary">
                <WeightTable items={listItems as ListItemWithGear[]} categories={categories} />
              </PanelCard>
            )}
          </div>

          {/* Items grouped by category */}
          {listItems.length === 0 ? (
            <div className="flex h-32 items-center justify-center rounded-xl border-2 border-dashed border-gray-200">
              <p className="text-sm text-gray-400">No items — add from your gear library</p>
            </div>
          ) : (() => {
            // Props shared by every category group on this page. Per-category
            // bits (id, name, items, onAddItem with the right categoryId) are
            // applied at each callsite.
            const sharedGroupProps = {
              packMode: mode === 'pack',
              weightUnit,
              onUpdate: (itemId: string, patch: ListItemPatch) =>
                updateMut.mutate({ itemId, patch }),
              onDelete: (itemId: string) => deleteMut.mutate(itemId),
              onSaveGearName: (gearId: string, n: string) =>
                updateGearItemMut.mutate({ id: gearId, patch: { name: n } }),
              onSaveGearDescription: (gearId: string, d: string) =>
                updateGearItemMut.mutate({ id: gearId, patch: { description: d } }),
              onSaveGearWeight: (gearId: string, w: number) =>
                updateGearItemMut.mutate({ id: gearId, patch: { weight_grams: w } }),
              onReorderItems: handleItemsReorder,
            }
            return (
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
                          {...sharedGroupProps}
                          onAddItem={(data) => addNewItemMut.mutate({ categoryId: group.category!.id, data })}
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
                      {...sharedGroupProps}
                      onAddItem={(data) => addNewItemMut.mutate({ categoryId: null, data })}
                    />
                  ))}
              </div>
            )
          })()}
        </div>
      </div>

      {/* Mobile sheet */}
      <LibrarySheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        gearItems={gearItems}
        categories={categories}
        listItemGearIds={listItemGearIds}
        weightUnit={weightUnit}
        onAdd={(item) => { addMut.mutate(item); setSheetOpen(false) }}
        onRemove={(item) => {
          const li = listItems.find((l) => l.gear_item_id === item.id)
          if (li) deleteMut.mutate(li.id)
        }}
        onDelete={(item) => deleteGearItemMut.mutate(item.id)}
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

      {/* Delete confirmation */}
      {confirmDeleteList && (
        <TypedConfirmDialog
          title="Delete list"
          message={`This will permanently delete "${confirmDeleteList.name}" and all of its items. This cannot be undone.`}
          confirmPhrase="delete"
          confirmLabel="Delete list"
          onCancel={() => setConfirmDeleteList(null)}
          onConfirm={() => {
            const target = confirmDeleteList
            setConfirmDeleteList(null)
            deleteListMut.mutate(target.id)
          }}
        />
      )}
    </div>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────────────

type GroupProps = {
  name: string
  items: ListItemWithGear[]
  packMode: boolean
  weightUnit: WeightUnit
  onUpdate: (itemId: string, patch: ListItemPatch) => void
  onDelete: (itemId: string) => void
  onReorderItems: (orderedItems: ListItemWithGear[]) => void
  onSaveGearName: (gearItemId: string, name: string) => void
  onSaveGearDescription: (gearItemId: string, description: string) => void
  onSaveGearWeight: (gearItemId: string, weight_grams: number) => void
  onAddItem: (data: AddItemData) => void
  dragHandle?: React.ReactNode
}

function ListCategoryGroup({ name, items, packMode, weightUnit, onUpdate, onDelete, onReorderItems, onSaveGearName, onSaveGearDescription, onSaveGearWeight, onAddItem, dragHandle }: GroupProps) {
  const [adding, setAdding] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const packedCount = items.filter((i) => i.is_packed).length
  const totalGrams = items.reduce((s, i) => s + (i.gear_item?.weight_grams ?? 0) * i.quantity, 0)

  const itemSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  function handleItemDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const oldIndex = items.findIndex((i) => i.id === active.id)
    const newIndex = items.findIndex((i) => i.id === over.id)
    if (oldIndex === -1 || newIndex === -1) return
    onReorderItems(arrayMove(items, oldIndex, newIndex))
  }

  return (
    <div>
      {/* Header — also functions as the column header for Weight / Qty */}
      <div className="flex items-center gap-1.5 rounded-lg px-3 py-0.5 bg-gray-100 mb-1">
        {dragHandle}
        <button
          onClick={() => setCollapsed((v) => !v)}
          className="flex flex-1 min-w-0 items-center gap-1.5 text-left"
        >
          {collapsed ? (
            <ChevronRight size={14} className="text-gray-400 shrink-0" />
          ) : (
            <ChevronDown size={14} className="text-gray-400 shrink-0" />
          )}
          <span className="truncate text-sm font-medium text-gray-700">{name}</span>
          <span className="shrink-0 text-xs text-gray-400">
            {packMode ? `${packedCount} / ${items.length}` : `(${items.length})`}
          </span>
        </button>
        {!packMode ? (
          <>
            <div className="shrink-0 w-7" />
            <div className="shrink-0 w-7" />
            <div className="shrink-0 w-12 text-right text-[10px] font-semibold uppercase tracking-wider text-gray-500">
              Qty
            </div>
            <div className="shrink-0 w-16 text-right text-[10px] font-semibold uppercase tracking-wider text-gray-500">
              Weight
            </div>
            <div className="shrink-0 w-7" />
          </>
        ) : (
          <>
            <div className="shrink-0 w-7" />
            <div className="shrink-0 w-7" />
            <div className="shrink-0 w-10 text-right text-[10px] font-semibold uppercase tracking-wider text-gray-500">
              Qty
            </div>
          </>
        )}
      </div>

      {/* Items + footer (footer is the row's "total" line, lined up under Weight) */}
      {!collapsed && (
        <div className="pl-2">
          <DndContext sensors={itemSensors} collisionDetection={closestCenter} onDragEnd={handleItemDragEnd}>
            <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
              {items.map((item) => {
                const gearId = item.gear_item?.id
                return (
                  <ListItemRow
                    key={item.id}
                    item={item}
                    packMode={packMode}
                    weightUnit={weightUnit}
                    onUpdate={(patch) => onUpdate(item.id, patch)}
                    onSaveName={gearId ? (n) => onSaveGearName(gearId, n) : undefined}
                    onSaveDescription={gearId ? (d) => onSaveGearDescription(gearId, d) : undefined}
                    onSaveWeight={gearId ? (w) => onSaveGearWeight(gearId, w) : undefined}
                    onDelete={() => onDelete(item.id)}
                  />
                )
              })}
            </SortableContext>
          </DndContext>

          {/* Draft row when adding — full editable item row */}
          {!packMode && adding && (
            <AddItemRow
              onSubmit={(data) => { onAddItem(data); setAdding(false) }}
              onCancel={() => setAdding(false)}
            />
          )}

          {/* Footer row — "+ Add new item" on the left, category total on the right */}
          {!packMode && !adding && (
            <div className="flex items-center gap-1.5 px-3 py-0.5 text-xs">
              <button
                onClick={() => setAdding(true)}
                className="flex flex-1 min-w-0 items-center gap-1 text-left text-gray-400 hover:text-blue-600"
              >
                <Plus size={12} /> Add new item
              </button>
              <div className="shrink-0 w-7" />
              <div className="shrink-0 w-7" />
              <div className="shrink-0 w-12" />
              <div className="shrink-0 w-16 text-right tabular-nums font-semibold text-gray-700">
                {items.length > 0 ? formatItemWeight(totalGrams, weightUnit) : ''}
              </div>
              <div className="shrink-0 w-7" />
            </div>
          )}
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
      ref={asButtonRef(setActivatorNodeRef)}
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

function PackingProgress({
  total,
  packed,
  onReset,
}: {
  total: number
  packed: number
  onReset: () => void
}) {
  const pct = total === 0 ? 0 : Math.round((packed / total) * 100)
  const done = packed === total && total > 0

  return (
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
                  <td className="px-3 py-1.5 text-right tabular-nums text-gray-600">{formatItemWeight(row.weight_grams, 'g')}</td>
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

function InlineTitle({ name, onSave }: { name: string; onSave: (next: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(name)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  function commit() {
    const trimmed = draft.trim()
    if (trimmed && trimmed !== name) onSave(trimmed)
    setEditing(false)
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        maxLength={256}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') { setDraft(name); setEditing(false) }
        }}
        className="flex-1 min-w-0 rounded border border-blue-400 bg-white px-2 py-0.5 text-xl font-semibold text-gray-900 focus:outline-none"
      />
    )
  }

  return (
    <h1
      onClick={() => { setDraft(name); setEditing(true) }}
      title="Click to rename"
      className="flex-1 min-w-0 cursor-text truncate rounded px-2 py-0.5 -mx-2 text-xl font-semibold text-gray-900 hover:bg-gray-100"
    >
      {name}
    </h1>
  )
}

function PanelCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden flex flex-col">
      <div className="px-3 py-2 border-b border-gray-200 bg-gray-50">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{title}</p>
      </div>
      <div className="flex-1 flex flex-col">{children}</div>
    </div>
  )
}

function NotesEditor({
  initial,
  onSave,
}: {
  initial: string
  onSave: (description: string) => void
}) {
  const [draft, setDraft] = useState(initial)

  function commit() {
    const trimmed = draft.trim()
    if (trimmed !== initial.trim()) onSave(trimmed)
  }

  return (
    <textarea
      value={draft}
      maxLength={2000}
      placeholder="Add notes about this packing list…"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      className="flex-1 min-h-[8rem] w-full resize-none px-3 py-2 text-sm text-gray-700 placeholder:text-gray-400 focus:outline-none"
    />
  )
}

function AddItemRow({
  onSubmit,
  onCancel,
}: {
  onSubmit: (data: AddItemData) => void
  onCancel: () => void
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [weight, setWeight] = useState('0')
  const [quantity, setQuantity] = useState('1')
  const [worn, setWorn] = useState(false)
  const [consumable, setConsumable] = useState(false)

  function commit() {
    const trimmed = name.trim()
    if (!trimmed) return
    const w = Math.max(0, Math.min(parseInt(weight, 10) || 0, 100000))
    const q = Math.max(1, Math.min(parseInt(quantity, 10) || 1, 99))
    onSubmit({
      name: trimmed.slice(0, 256),
      description: description.trim() ? description.trim().slice(0, 2000) : null,
      weight_grams: w,
      quantity: q,
      is_worn: worn,
      is_consumable: consumable,
    })
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter') commit()
    if (e.key === 'Escape') onCancel()
  }

  // Commit (or cancel, if name is empty) when focus leaves the entire row —
  // not just one input. relatedTarget is the element receiving focus next; if
  // it's a child of this row, the user is just tabbing between fields and we
  // shouldn't commit yet.
  function handleRowBlur(e: React.FocusEvent<HTMLDivElement>) {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
    if (name.trim()) commit()
    else onCancel()
  }

  return (
    <div
      onBlur={handleRowBlur}
      className="flex items-center gap-1.5 border-b border-gray-100 bg-blue-50/40 px-3 py-0.5 text-sm"
    >
      <div className="flex-1 min-w-0 flex items-center gap-3">
        <input
          autoFocus
          value={name}
          placeholder="Item name"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={handleKey}
          maxLength={256}
          className="flex-[2] min-w-0 rounded border border-blue-400 px-1 py-0.5 text-sm font-medium focus:outline-none"
        />
        <input
          value={description}
          placeholder="Description (optional)"
          onChange={(e) => setDescription(e.target.value)}
          onKeyDown={handleKey}
          maxLength={2000}
          className="flex-[3] min-w-0 rounded border border-gray-200 px-1 py-0.5 text-xs focus:outline-none focus:border-blue-400"
        />
      </div>

      <button
        type="button"
        onClick={() => { setWorn((v) => !v); if (!worn) setConsumable(false) }}
        title="Worn"
        className={`shrink-0 w-7 h-6 inline-flex items-center justify-center rounded ${
          worn ? 'bg-purple-100 text-purple-700' : 'text-gray-400 hover:text-gray-700 hover:bg-gray-100'
        }`}
      >
        <Shirt size={14} />
      </button>
      <button
        type="button"
        onClick={() => { setConsumable((v) => !v); if (!consumable) setWorn(false) }}
        title="Consumable"
        className={`shrink-0 w-7 h-6 inline-flex items-center justify-center rounded ${
          consumable ? 'bg-orange-100 text-orange-700' : 'text-gray-400 hover:text-gray-700 hover:bg-gray-100'
        }`}
      >
        <UtensilsCrossed size={14} />
      </button>

      <input
        type="number"
        min={1}
        max={99}
        value={quantity}
        onChange={(e) => setQuantity(e.target.value)}
        onKeyDown={handleKey}
        className="shrink-0 w-12 rounded border border-blue-400 px-1 py-0.5 text-right tabular-nums focus:outline-none"
      />
      <input
        type="number"
        min={0}
        max={100000}
        value={weight}
        onChange={(e) => setWeight(e.target.value)}
        onKeyDown={handleKey}
        className="shrink-0 w-16 rounded border border-blue-400 px-1 py-0.5 text-right tabular-nums focus:outline-none"
      />

      <button
        type="button"
        onClick={onCancel}
        title="Cancel"
        className="shrink-0 w-7 h-6 inline-flex items-center justify-center rounded text-gray-400 hover:text-red-600 hover:bg-red-50"
      >
        <XCircle size={14} />
      </button>
    </div>
  )
}

function PrivacyButton({ list }: { list: List }) {
  const qc = useQueryClient()
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null)
  const [copied, setCopied] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const open = pos !== null

  const toggleMut = useMutation({
    mutationFn: () => updateList(list.id, { is_shared: !list.is_shared }),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.lists() }),
  })

  function openPopover() {
    if (!triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    setPos({ top: rect.bottom + 6, right: window.innerWidth - rect.right })
  }

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      const t = e.target as Node
      if (
        popoverRef.current && !popoverRef.current.contains(t) &&
        triggerRef.current && !triggerRef.current.contains(t)
      ) {
        setPos(null)
      }
    }
    function handleScroll() { setPos(null) }
    document.addEventListener('mousedown', handleClick)
    window.addEventListener('scroll', handleScroll, true)
    window.addEventListener('resize', handleScroll)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      window.removeEventListener('scroll', handleScroll, true)
      window.removeEventListener('resize', handleScroll)
    }
  }, [open])

  const shareUrl = `${window.location.origin}/r/${list.share_token}`

  return (
    <>
      <button
        ref={triggerRef}
        onClick={() => (open ? setPos(null) : openPopover())}
        title={list.is_shared ? 'Public — click to manage' : 'Private — click to manage'}
        aria-pressed={list.is_shared}
        className={`inline-flex items-center justify-center rounded-lg border p-1.5 ${
          list.is_shared
            ? 'border-green-300 bg-green-50 text-green-700 hover:bg-green-100'
            : 'border-gray-300 text-gray-500 hover:bg-gray-50'
        }`}
      >
        {list.is_shared ? <Globe size={16} /> : <Lock size={16} />}
      </button>

      {open && pos && createPortal(
        <div
          ref={popoverRef}
          className="fixed z-50 w-80 rounded-lg border border-gray-200 bg-white p-3 shadow-lg"
          style={{ top: pos.top, right: pos.right }}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-800">Public link</span>
            <ToggleSwitch checked={list.is_shared} onChange={() => toggleMut.mutate()} />
          </div>
          {list.is_shared ? (
            <>
              <p className="text-xs text-gray-500 mb-2">Anyone with this link can view the list.</p>
              <div className="flex gap-1">
                <input
                  readOnly
                  value={shareUrl}
                  onFocus={(e) => e.currentTarget.select()}
                  className="flex-1 min-w-0 rounded border border-gray-200 bg-gray-50 px-2 py-1.5 text-xs font-mono text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(shareUrl)
                      setCopied(true)
                      setTimeout(() => setCopied(false), 1500)
                    } catch {
                      // ignore — clipboard unavailable
                    }
                  }}
                  className="inline-flex items-center gap-1 rounded border border-gray-300 px-2 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
                >
                  {copied ? (
                    <><Check size={12} className="text-green-600" /> Copied</>
                  ) : (
                    <><Copy size={12} /> Copy</>
                  )}
                </button>
              </div>
            </>
          ) : (
            <p className="text-xs text-gray-500">Toggle on to share this list with anyone via link.</p>
          )}
        </div>,
        document.body,
      )}
    </>
  )
}

function ToggleSwitch({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
        checked ? 'bg-blue-600' : 'bg-gray-300'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform ${
          checked ? 'translate-x-[18px]' : 'translate-x-0.5'
        }`}
      />
    </button>
  )
}
