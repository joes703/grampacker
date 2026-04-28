import { useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate } from 'react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  DndContext,
  DragOverlay,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { SortableContext, arrayMove, verticalListSortingStrategy } from '@dnd-kit/sortable'
import {
  BookOpen,
  ClipboardList,
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
import { getLastListId, setLastListId } from '../lib/preferences'
import { useCsvFileInput } from '../lib/use-csv-file-input'
import { useWeightUnit } from '../lib/use-weight-unit'
import { assignSortOrderSlots, groupListItemsByCategory } from '../lib/grouping'
import WeightTable from './WeightTable'
import LibraryPanel from './LibraryPanel'
import LibrarySheet from './LibrarySheet'
import ListsBox from './ListsBox'
import ListsEmptyState from './ListsEmptyState'
import PackingProgress from './PackingProgress'
import InlineTitle from './InlineTitle'
import NotesEditor from './NotesEditor'
import { type AddItemData } from './AddItemRow'
import PrivacyButton from './PrivacyButton'
import ListImportPreviewDialog from './ListImportPreviewDialog'
import CategoryGroup, { SortableCategoryGroup } from './CategoryGroup'
import PanelCard from './PanelCard'
import { parseCategoryDroppableId } from './CategoryGroup'
import ItemRow from './ItemRow'
import GearItemDialog from '../gear/GearItemDialog'
import ConfirmDialog from '../components/ConfirmDialog'
import Modal from '../components/Modal'

type Mode = 'edit' | 'pack'

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
  // Sidebar (Lists box + gear library panel) auto-collapses in pack mode so
  // the user can focus on packing, and re-opens on return to edit mode.
  const [sidebarOpen, setSidebarOpen] = useState(true)
  useEffect(() => {
    setSidebarOpen(mode !== 'pack')
  }, [mode])
  const { weightUnit, toggleWeightUnit } = useWeightUnit()
  const [sheetOpen, setSheetOpen] = useState(false)
  const [importPreview, setImportPreview] = useState<ListImportRow[] | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [confirmDeleteList, setConfirmDeleteList] = useState<List | null>(null)
  const [editingGearItem, setEditingGearItem] = useState<GearItem | null>(null)
  const [deleteGearCandidate, setDeleteGearCandidate] = useState<GearItem | null>(null)
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
  // draft row in CategoryGroup collects all the fields up front.
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

  // Active drag id (item id OR category id). The DragOverlay below uses it to
  // render an item-row clone during item drag; for category drag we render
  // null so dnd-kit's default behaviour (the original element follows the
  // cursor) applies.
  const [activeId, setActiveId] = useState<string | null>(null)

  // Cross-category move: updates gear_items.category_id (global, propagates to
  // every list containing this gear item) and renumbers list_items.sort_order
  // in the destination category so the moved row lands where the user dropped
  // it. Optimistic across both ['list-items', listId] and ['gear-items']; on
  // error both rollback. ['list-items'] (broad) is invalidated on settle so
  // other lists embedding the same gear item refresh.
  const moveAcrossCategoriesMut = useMutation({
    mutationFn: async ({
      gearItemId,
      newCategoryId,
      sortUpdates,
    }: {
      gearItemId: string
      newCategoryId: string | null
      sortUpdates: { id: string; sort_order: number }[]
    }) => {
      await updateGearItem(gearItemId, { category_id: newCategoryId })
      if (sortUpdates.length) await reorderListItems(sortUpdates)
    },
    onMutate: async ({ gearItemId, newCategoryId, sortUpdates }) => {
      await qc.cancelQueries({ queryKey: queryKeys.listItems(listId) })
      await qc.cancelQueries({ queryKey: queryKeys.gearItems() })
      const prevListItems = qc.getQueryData<ListItemWithGear[]>(queryKeys.listItems(listId))
      const prevGearItems = qc.getQueryData<GearItem[]>(queryKeys.gearItems())
      const sortMap = new Map(sortUpdates.map((u) => [u.id, u.sort_order]))
      qc.setQueryData<ListItemWithGear[]>(queryKeys.listItems(listId), (curr) => {
        if (!curr) return curr
        return curr.map((li) => {
          let next = li
          if (li.gear_item?.id === gearItemId) {
            next = { ...next, gear_item: { ...next.gear_item!, category_id: newCategoryId } }
          }
          if (sortMap.has(li.id)) next = { ...next, sort_order: sortMap.get(li.id)! }
          return next
        })
      })
      qc.setQueryData<GearItem[]>(queryKeys.gearItems(), (curr) => {
        if (!curr) return curr
        return curr.map((g) =>
          g.id === gearItemId ? { ...g, category_id: newCategoryId } : g,
        )
      })
      return { prevListItems, prevGearItems }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prevListItems) qc.setQueryData(queryKeys.listItems(listId), ctx.prevListItems)
      if (ctx?.prevGearItems) qc.setQueryData(queryKeys.gearItems(), ctx.prevGearItems)
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: queryKeys.listItems(listId) })
      qc.invalidateQueries({ queryKey: ['list-items'] })
      qc.invalidateQueries({ queryKey: queryKeys.gearItems() })
    },
  })

  function handleDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id))
  }

  function handleDragCancel() {
    setActiveId(null)
  }

  // Single page-level drag handler. Branches on whether active.id is a
  // category id (run the category-drag flow) or an item id (run the item-drag
  // flow with same-cat sort vs cross-cat move logic).
  function handleDragEnd(e: DragEndEvent) {
    setActiveId(null)
    const { active, over } = e
    if (!over) return
    if (active.id === over.id) return

    const activeIdStr = String(active.id)
    const overIdStr = String(over.id)
    const categoryIds = new Set(categories.map((c) => c.id))

    // Category-drag branch: active.id is a category id.
    if (categoryIds.has(activeIdStr)) {
      const sortedCats = [...categories].sort((a, b) => a.sort_order - b.sort_order)
      const oldIndex = sortedCats.findIndex((c) => c.id === activeIdStr)
      if (oldIndex === -1) return

      // Resolve over.id to a target category id. closestCenter picks the
      // closest droppable, which is often an item row or a category drop
      // zone rather than the raw category outer-wrapper id — handle all
      // three shapes here.
      let destCatId: string | null
      if (categoryIds.has(overIdStr)) {
        destCatId = overIdStr
      } else {
        const parsed = parseCategoryDroppableId(overIdStr)
        if (parsed !== undefined) {
          destCatId = parsed
        } else {
          const overItem = listItems.find((i) => i.id === overIdStr)
          destCatId = overItem?.gear_item?.category_id ?? null
        }
      }
      // Uncategorised is not a real category row — no reorder target.
      if (destCatId === null) return
      const newIndex = sortedCats.findIndex((c) => c.id === destCatId)
      if (newIndex === -1 || newIndex === oldIndex) return

      const reordered = arrayMove(sortedCats, oldIndex, newIndex)
      reorderCatsMut.mutate(reordered.map((c, i) => ({ id: c.id, sort_order: i })))
      return
    }

    // Item-drag branch.
    const activeItem = listItems.find((i) => i.id === activeIdStr)
    if (!activeItem || !activeItem.gear_item) return
    const activeCat = activeItem.gear_item.category_id ?? null
    const gearItemId = activeItem.gear_item.id

    const parsedCat = parseCategoryDroppableId(overIdStr)
    let destCat: string | null
    let overItemId: string | null = null
    if (parsedCat !== undefined) {
      destCat = parsedCat
    } else {
      overItemId = overIdStr
      const overItem = listItems.find((i) => i.id === overItemId)
      if (!overItem) return
      destCat = overItem.gear_item?.category_id ?? null
    }

    if (destCat === activeCat) {
      // Same-category sort reorder
      if (!overItemId) return
      const itemsInCat = listItems.filter(
        (i) => (i.gear_item?.category_id ?? null) === activeCat,
      )
      const oldIndex = itemsInCat.findIndex((i) => i.id === activeIdStr)
      const newIndex = itemsInCat.findIndex((i) => i.id === overItemId)
      if (oldIndex === -1 || newIndex === -1) return
      const reordered = arrayMove(itemsInCat, oldIndex, newIndex)
      reorderItemsMut.mutate(assignSortOrderSlots(reordered))
      return
    }

    // Cross-category drop. Compute destination items in their new order with
    // the moved item inserted, then renumber the destination's sort_order
    // slots from the existing pool of values. Sort explicitly: fetchListItems
    // returns sorted, but the previous optimistic update may have left the
    // cache out of order, so we can't rely on filter preserving sort_order.
    const destItems = listItems
      .filter((i) => (i.gear_item?.category_id ?? null) === destCat && i.id !== activeItem.id)
      .sort((a, b) => a.sort_order - b.sort_order)
    let insertIdx: number
    if (overItemId) {
      const idx = destItems.findIndex((i) => i.id === overItemId)
      insertIdx = idx === -1 ? destItems.length : idx
    } else {
      insertIdx = destItems.length
    }
    const newDestOrder = [
      ...destItems.slice(0, insertIdx),
      activeItem,
      ...destItems.slice(insertIdx),
    ]
    const sortUpdates = assignSortOrderSlots(newDestOrder)
    moveAcrossCategoriesMut.mutate({ gearItemId, newCategoryId: destCat, sortUpdates })
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

  const grouped = groupListItemsByCategory(listItems, categories)

  // Per-row handler bag passed to every CategoryGroup. Memoized so each
  // category section doesn't re-render on every parent state change — only
  // when one of these dependencies actually moves. The mutation `.mutate`
  // refs are stable across renders by TanStack Query, so they don't need to
  // be in the deps list.
  const sharedGroupProps = useMemo(
    () => ({
      packMode: mode === 'pack',
      weightUnit,
      sortable: true,
      onUpdate: (itemId: string, patch: ListItemPatch) =>
        updateMut.mutate({ itemId, patch }),
      onDelete: (itemId: string) => deleteMut.mutate(itemId),
      onSaveGearName: (gearId: string, n: string) =>
        updateGearItemMut.mutate({ id: gearId, patch: { name: n } }),
      onSaveGearDescription: (gearId: string, d: string) =>
        updateGearItemMut.mutate({ id: gearId, patch: { description: d } }),
      onSaveGearWeight: (gearId: string, w: number) =>
        updateGearItemMut.mutate({ id: gearId, patch: { weight_grams: w } }),
      onEditGearItem: (gearId: string) => {
        const g = gearItems.find((x) => x.id === gearId)
        if (g) setEditingGearItem(g)
      },
      onDeleteGearItem: (gearId: string) => {
        const g = gearItems.find((x) => x.id === gearId)
        if (g) setDeleteGearCandidate(g)
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mode, weightUnit, gearItems],
  )

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
        {/* Manual sidebar toggle disabled — sidebar now auto-collapses in pack
            mode (see effect above) and stays open in edit mode. To restore
            manual toggling, uncomment this button and drop the effect.
        <button
          onClick={() => setSidebarOpen((v) => !v)}
          title={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
          className="hidden lg:inline-flex rounded p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100"
        >
          {sidebarOpen ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
        </button>
        */}
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
            className="hidden lg:flex w-80 shrink-0 flex-col gap-4 sticky self-start"
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
              <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 bg-gray-50">
                <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Gear library
                </span>
                <button
                  type="button"
                  onClick={() => navigate(`/gear?from=${list.id}`)}
                  className="text-xs text-blue-600 hover:text-blue-700"
                >
                  Manage
                </button>
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
              <p className="text-sm text-gray-400 italic">No items — add from your gear library</p>
            </div>
          ) : (() => {
            // Flat item id list across all categories, in render order. The
            // inner <SortableContext> needs every draggable id registered;
            // verticalListSortingStrategy handles cross-category visual shifts.
            const flatItemIds = grouped.flatMap((g) => g.items.map((i) => i.id))
            const activeItem = activeId
              ? listItems.find((i) => i.id === activeId)
              : null
            return (
              <div className="space-y-4">
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragStart={handleDragStart}
                  onDragEnd={handleDragEnd}
                  onDragCancel={handleDragCancel}
                >
                  {/* Categories SortableContext is outer; items inner. With
                      one DndContext, every useSortable inside reads the
                      nearest SortableContext (items). Item drag gets the
                      strategy auto-shift; category drag fires but renders
                      via dnd-kit's default (original element follows the
                      cursor) since its id isn't in the inner items list. */}
                  <SortableContext
                    items={grouped.filter((g) => g.category !== null).map((g) => g.category!.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    <SortableContext items={flatItemIds} strategy={verticalListSortingStrategy}>
                      {grouped
                        .filter((g) => g.category !== null)
                        .map((group) => (
                          <SortableCategoryGroup
                            key={group.category!.id}
                            id={group.category!.id}
                            categoryId={group.category!.id}
                            name={group.category!.name}
                            items={group.items}
                            {...sharedGroupProps}
                            onAddItem={(data) => addNewItemMut.mutate({ categoryId: group.category!.id, data })}
                          />
                        ))}
                      {grouped
                        .filter((g) => g.category === null)
                        .map((group) => (
                          <CategoryGroup
                            key="__uncategorised__"
                            name="Uncategorised"
                            categoryId={null}
                            items={group.items}
                            {...sharedGroupProps}
                            onAddItem={(data) => addNewItemMut.mutate({ categoryId: null, data })}
                          />
                        ))}
                    </SortableContext>
                  </SortableContext>
                  <DragOverlay>
                    {activeItem ? (
                      <ItemRow item={activeItem} weightUnit={weightUnit} />
                    ) : null}
                  </DragOverlay>
                </DndContext>
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
      />

      {/* Import error */}
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

      {/* Import preview */}
      {importPreview && (
        <ListImportPreviewDialog
          rows={importPreview}
          saving={importMut.isPending}
          onConfirm={() => importMut.mutate(importPreview)}
          onClose={() => setImportPreview(null)}
        />
      )}

      {/* Delete confirmation */}
      {confirmDeleteList && (
        <ConfirmDialog
          title="Delete list"
          message={`This will permanently delete "${confirmDeleteList.name}" and all of its items. This cannot be undone.`}
          confirmLabel="Delete list"
          dangerous
          onCancel={() => setConfirmDeleteList(null)}
          onConfirm={() => {
            const target = confirmDeleteList
            setConfirmDeleteList(null)
            deleteListMut.mutate(target.id)
          }}
        />
      )}

      {/* Gear-item edit (reached from the kebab on each list-view row).
          Reuses GearItemDialog from the gear library page; updateGearItemMut
          invalidates ['list-items'] so other lists pick up the change. */}
      {editingGearItem && (
        <GearItemDialog
          categories={categories}
          item={editingGearItem}
          saving={updateGearItemMut.isPending}
          onClose={() => setEditingGearItem(null)}
          onSave={(patch) => {
            const target = editingGearItem
            updateGearItemMut.mutate(
              { id: target.id, patch },
              { onSuccess: () => setEditingGearItem(null) },
            )
          }}
        />
      )}

      {/* Delete-from-inventory confirm (reached from the kebab). Removes the
          gear item from the library; list_items survive as "(deleted item)"
          due to ON DELETE SET NULL on gear_item_id. */}
      {deleteGearCandidate && (
        <ConfirmDialog
          title="Delete from inventory"
          message={`This will remove "${deleteGearCandidate.name}" from your inventory and from any list it appears on. This cannot be undone.`}
          confirmLabel="Delete"
          dangerous
          onCancel={() => setDeleteGearCandidate(null)}
          onConfirm={() => {
            const target = deleteGearCandidate
            setDeleteGearCandidate(null)
            deleteGearItemMut.mutate(target.id)
          }}
        />
      )}

    </div>
  )
}

