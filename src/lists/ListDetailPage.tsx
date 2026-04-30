import { useMemo, useState } from 'react'
import { useParams, useNavigate } from 'react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  DndContext,
  DragOverlay,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { ClipboardList, X } from 'lucide-react'
import { Drawer } from 'vaul'
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
  resetPackedForList,
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
import { parseListCsv, listItemsToCsv, downloadCsv, nameFromCsvFilename, type ListImportRow } from '../lib/csv'
import { useCsvFileInput } from '../lib/use-csv-file-input'
import { useWeightUnit } from '../lib/use-weight-unit'
import { assignSortOrderSlots, groupListItemsByCategory } from '../lib/grouping'
import WeightTable from './WeightTable'
import LibraryPanel from './LibraryPanel'
import ListsBox from './ListsBox'
import PackingProgress from './PackingProgress'
import InlineTitle from './InlineTitle'
import NotesEditor from './NotesEditor'
import { type AddItemData } from './AddItemRow'
import PrivacyButton from './PrivacyButton'
import ListImportPreviewDialog from './ListImportPreviewDialog'
import CategoryGroup, { SortableCategoryGroup } from './CategoryGroup'
import PanelCard from './PanelCard'
import ItemRow from './ItemRow'
import GearItemDialog from '../gear/GearItemDialog'
import ConfirmDialog from '../components/ConfirmDialog'
import Modal from '../components/Modal'
import { useDocumentTitle } from '../lib/use-document-title'
import { useRegisterSidebarDrawer } from '../layout/sidebar-drawer-context'

type Mode = 'edit' | 'pack'

// Every transient dialog/modal/inline-form on this page lives in one
// discriminated union, set/cleared atomically. `null` is the closed state
// (matching the pattern in src/gear/GearLibraryPage.tsx). edit-gear folds
// the optional list-item context AND the partial-save error message into
// one variant so they can never drift apart.
type DialogState =
  | { type: 'edit-gear'; gear: GearItem; listItem: ListItemWithGear | null; saveError: string | null }
  | { type: 'delete-gear'; candidate: GearItem }
  | { type: 'import-preview'; rows: ListImportRow[]; filename: string }
  | { type: 'import-error'; message: string }
  | { type: 'confirm-delete-list'; list: List }
  | { type: 'creating-list'; draft: string }

export default function ListDetailPage() {
  // Default title for the wrapper; ListDetailInner overrides with the list
  // name once it mounts and the list resolves. Stays as "Lists" briefly while
  // the lists query is pending.
  useDocumentTitle('Lists')
  // Mounted only at /lists/:id, so params.id is guaranteed by the route.
  // Asserting here narrows routeId to string for ListDetailInner's listId prop.
  const { id } = useParams<{ id: string }>()
  const routeId = id!
  const navigate = useNavigate()
  const { session } = useAuth()
  const qc = useQueryClient()

  const { data: lists = [] } = useQuery({
    queryKey: queryKeys.lists(),
    queryFn: fetchLists,
  })

  // Lists ordered by most recently updated — used by the post-delete handler
  // in ListDetailInner to pick the next list to navigate to.
  const listsByRecent = [...lists].sort(
    (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
  )

  // PrivateRoute usually keeps session non-null here, but if it goes null
  // mid-render (logout), bail out cleanly instead of throwing.
  if (!session) return null
  const userId = session.user.id

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
  const { weightUnit, toggleWeightUnit } = useWeightUnit()
  // Pack-mode filter: when true, hide already-packed items from each
  // category. Header counts and the "complete" affordance still reflect the
  // full items array. Lifted here because both PackingProgress (the toggle)
  // and CategoryGroup (the filter consumer) live as children of this page.
  const [showUnpackedOnly, setShowUnpackedOnly] = useState(false)
  // Pack-mode "Group worn" toggle — when true, is_worn items are pulled out
  // of their categories and rendered in a flat Worn section at the bottom,
  // mirroring how worn gear sits by the door rather than in the pack. State
  // is per-instance (resets on list switch via key=routeId) and pack-mode
  // only; edit mode ignores it.
  const [groupWorn, setGroupWorn] = useState(false)
  // Mobile sidebar drawer — open/setOpen are owned by SidebarDrawerContext
  // so the trigger button in NavBar (a sibling subtree under AppShell) can
  // toggle the same state. The hook also sets `available` so NavBar knows
  // to render the trigger only on this page.
  const { open: drawerOpen, setOpen: setDrawerOpen } = useRegisterSidebarDrawer()
  // Single discriminated union for every transient dialog/modal/inline-form
  // on this page. Mirrors the pattern in src/gear/GearLibraryPage.tsx —
  // `type` discriminator, `null` for the closed state. Folding gearDialogError
  // (for partial-save messaging) into the edit-gear variant means closing the
  // dialog or switching to a different gear item naturally discards the
  // error: there's no separate state to keep in sync.
  const [dialog, setDialog] = useState<DialogState | null>(null)
  const {
    inputRef: importInputRef,
    onChange: handleImportFile,
    openPicker: openImportPicker,
  } = useCsvFileInput<ListImportRow>(
    parseListCsv,
    {
      onParsed: (rows, filename) => setDialog({ type: 'import-preview', rows, filename }),
      onError: (message) => setDialog({ type: 'import-error', message }),
    },
  )

  const list = lists.find((l) => l.id === listId)
  // Inner overrides the wrapper's "Lists" default with the list name once
  // it resolves; falls back to "Lists" while the lists query is pending so
  // the title doesn't briefly drop to the bare app name.
  useDocumentTitle(list?.name ?? 'Lists')

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

  // Import-CSV creates a brand new list named after the source filename and
  // populates it with the CSV rows. Single transaction-shaped flow at the
  // call-site: createList, then importCsvRowsToList against the new list id.
  // After success we navigate the user into the new list so they see the
  // imported items immediately.
  const importMut = useMutation({
    mutationFn: async ({ name, rows }: { name: string; rows: ListImportRow[] }) => {
      const newList = await createList(userId, name, lists.length)
      await importCsvRowsToList(newList.id, userId, rows, gearItems, categories, 0)
      return newList
    },
    onSuccess: (newList) => {
      qc.invalidateQueries({ queryKey: queryKeys.lists() })
      qc.invalidateQueries({ queryKey: queryKeys.gearItems() })
      qc.invalidateQueries({ queryKey: queryKeys.categories() })
      setDialog(null)
      navigate(`/lists/${newList.id}`)
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
  // gear_items.id is referenced by list_items with ON DELETE CASCADE on gear_item_id,
  // so deleting a gear item also removes every list_item that references it.
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
      const [next] = listsByRecent.filter((l) => l.id !== deletedId)
      if (next) navigate(`/lists/${next.id}`, { replace: true })
      else navigate('/lists', { replace: true })
    },
  })

  const createListMut = useMutation({
    mutationFn: (name: string) => createList(userId, name, lists.length),
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: queryKeys.lists() })
      setDialog(null)
      navigate(`/lists/${created.id}`)
    },
  })

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  // Active drag id (item id OR category id). The DragOverlay below uses it to
  // render an item-row clone during item drag; for category drag we render
  // null so dnd-kit's default behaviour (the original element follows the
  // cursor) applies.
  const [activeId, setActiveId] = useState<string | null>(null)

  function handleDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id))
  }

  function handleDragCancel() {
    setActiveId(null)
  }

  // Single page-level drag handler. Two cases only:
  //   1. Reorder categories themselves (drag a category up/down).
  //   2. Reorder items within their existing category.
  // Cross-category drops are deliberately rejected — moving an item between
  // categories happens exclusively via the item edit modal. A drop whose
  // destination differs from the source category is ignored (item snaps
  // back); the visual auto-shift during drag still works because items live
  // in a single page-wide SortableContext.
  function handleDragEnd(e: DragEndEvent) {
    setActiveId(null)
    const { active, over } = e
    if (!over) return
    if (active.id === over.id) return

    const activeIdStr = String(active.id)
    const overIdStr = String(over.id)
    const categoryIds = new Set(categories.map((c) => c.id))

    // Case 1 — category reorder: active.id is a category id.
    if (categoryIds.has(activeIdStr)) {
      const sortedCats = [...categories].sort((a, b) => a.sort_order - b.sort_order)
      const oldIndex = sortedCats.findIndex((c) => c.id === activeIdStr)
      if (oldIndex === -1) return

      // Resolve over.id to a target category id. closestCenter picks the
      // closest droppable, which is often an item row rather than the
      // category outer-wrapper id, so handle both shapes.
      let destCatId: string | null
      if (categoryIds.has(overIdStr)) {
        destCatId = overIdStr
      } else {
        const overItem = listItems.find((i) => i.id === overIdStr)
        destCatId = overItem?.gear_item.category_id ?? null
      }
      // Uncategorised is not a real category row — no reorder target.
      if (destCatId === null) return
      const newIndex = sortedCats.findIndex((c) => c.id === destCatId)
      if (newIndex === -1 || newIndex === oldIndex) return

      const reordered = arrayMove(sortedCats, oldIndex, newIndex)
      reorderCatsMut.mutate(reordered.map((c, i) => ({ id: c.id, sort_order: i })))
      return
    }

    // Case 2 — within-category item reorder. The drop target must be another
    // item AND in the same category as the dragged item. Anything else
    // (cross-category drop, drop on empty space) is ignored.
    const activeItem = listItems.find((i) => i.id === activeIdStr)
    if (!activeItem) return
    const overItem = listItems.find((i) => i.id === overIdStr)
    if (!overItem) return
    const activeCat = activeItem.gear_item.category_id
    if (overItem.gear_item.category_id !== activeCat) return

    const itemsInCat = listItems.filter((i) => i.gear_item.category_id === activeCat)
    const oldIndex = itemsInCat.findIndex((i) => i.id === activeIdStr)
    const newIndex = itemsInCat.findIndex((i) => i.id === overIdStr)
    if (oldIndex === -1 || newIndex === -1) return
    const reordered = arrayMove(itemsInCat, oldIndex, newIndex)
    reorderItemsMut.mutate(assignSortOrderSlots(reordered))
  }

  async function resetPacked() {
    // Optimistic clear — flip is_packed=false on every cached item so the UI
    // updates immediately, then issue a single PATCH and invalidate to settle.
    await qc.cancelQueries({ queryKey: queryKeys.listItems(listId) })
    const previous = qc.getQueryData<ListItemWithGear[]>(queryKeys.listItems(listId))
    qc.setQueryData<ListItemWithGear[]>(queryKeys.listItems(listId), (curr) =>
      curr ? curr.map((i) => (i.is_packed ? { ...i, is_packed: false } : i)) : curr,
    )
    try {
      await resetPackedForList(listId)
    } catch (err) {
      if (previous) qc.setQueryData(queryKeys.listItems(listId), previous)
      throw err
    } finally {
      qc.invalidateQueries({ queryKey: queryKeys.listItems(listId) })
    }
  }


  // ── Derived data ───────────────────────────────────────────────────────────

  const listItemGearIds = useMemo(
    () => new Set(listItems.map((i) => i.gear_item_id)),
    [listItems],
  )

  const grouped = useMemo(
    () => groupListItemsByCategory(listItems, categories),
    [listItems, categories],
  )

  // Pack-mode + Group Worn: split the grouped items into "regular" (rendered
  // in their categories with worn items hidden) and "worn" (flattened in
  // walk-categories order — categories in display order, items in
  // sort_order within each — and rendered in the trailing Worn section).
  // When the toggle is off, displayedGrouped === grouped and wornItems is
  // empty so the existing render path is preserved exactly.
  const showWornGroup = mode === 'pack' && groupWorn
  const displayedGrouped = useMemo(
    () =>
      showWornGroup
        ? grouped.map((g) => ({ ...g, items: g.items.filter((i) => !i.is_worn) }))
        : grouped,
    [grouped, showWornGroup],
  )
  const wornItems = useMemo(
    () => (showWornGroup ? grouped.flatMap((g) => g.items.filter((i) => i.is_worn)) : []),
    [grouped, showWornGroup],
  )

  // Per-row handler bag passed to every CategoryGroup. Memoized so each
  // category section doesn't re-render on every parent state change.
  //
  // Mutation refs are intentionally NOT in deps. TanStack Query rebuilds the
  // useMutation result object on every render (the wrapper is fresh; only the
  // internal `.mutate` callback is stable), so depending on `updateMut` etc.
  // would defeat the memo and re-create this bag every render. Calling
  // `.mutate` through the live binding is safe: the closure resolves
  // `updateMut.mutate` at call time, which is always the current stable ref.
  // setDialog (the React useState setter) is React-guaranteed stable and
  // included for completeness.
  const sharedGroupProps = useMemo(
    () => ({
      packMode: mode === 'pack',
      weightUnit,
      sortable: true,
      showUnpackedOnly,
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
        const li = listItems.find((l) => l.gear_item.id === gearId)
        if (g) setDialog({ type: 'edit-gear', gear: g, listItem: li ?? null, saveError: null })
      },
      onDeleteGearItem: (gearId: string) => {
        const g = gearItems.find((x) => x.id === gearId)
        if (g) setDialog({ type: 'delete-gear', candidate: g })
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see comment above re: mutation refs
    [mode, weightUnit, showUnpackedOnly, gearItems, listItems],
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

      {/* Two-column grid (sidebar collapses in pack mode). The visibility
          condition is `mode !== 'pack'` — derived directly, not stored. */}
      <div className="flex gap-4 items-start">
        {/* LEFT column — Lists box + Library panel. Hidden in pack mode on
            desktop so the user can focus on packing. */}
        {mode !== 'pack' && (
          <aside
            className="hidden lg:flex w-80 shrink-0 flex-col gap-4 sticky self-start"
            style={{ top: '1rem', height: 'calc(100vh - 2rem)' }}
          >
            <ListsBox
              lists={lists}
              activeId={list.id}
              creating={dialog?.type === 'creating-list'}
              newDraft={dialog?.type === 'creating-list' ? dialog.draft : ''}
              onNewDraftChange={(v) => setDialog({ type: 'creating-list', draft: v })}
              onStartNew={() => setDialog({ type: 'creating-list', draft: '' })}
              onSubmitNew={() => {
                const draft = dialog?.type === 'creating-list' ? dialog.draft : ''
                const trimmed = draft.trim()
                if (trimmed) createListMut.mutate(trimmed)
                else setDialog(null)
              }}
              onCancelNew={() => setDialog(null)}
              onSelect={(l) => navigate(`/lists/${l.id}`)}
              onRename={(l, name) => renameMut.mutate({ id: l.id, name })}
              onStartImport={openImportPicker}
              onExport={async (l) => {
                const items = await qc.fetchQuery({
                  queryKey: queryKeys.listItems(l.id),
                  queryFn: () => fetchListItems(l.id),
                })
                const csv = listItemsToCsv(items, categories)
                downloadCsv(`${l.name.replace(/[^a-z0-9]/gi, '-').toLowerCase() || 'list'}.csv`, csv)
              }}
              onDuplicate={(l) => duplicateMut.mutate(l)}
              onDelete={(l) => setDialog({ type: 'confirm-delete-list', list: l })}
              onReorder={(orderedIds) => {
                reorderListsMut.mutate(orderedIds.map((id, i) => ({ id, sort_order: i })))
              }}
            />

            {/* Library panel */}
            <div className="flex flex-col rounded-xl border border-gray-200 bg-white overflow-hidden min-h-0 flex-1">
              <div className="flex items-center px-3 py-2 border-b border-gray-200 bg-gray-50">
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
                  />
              </div>
            </div>
          </aside>
        )}

        {/* RIGHT column — weight table + items (always visible; packing checkbox column appears in pack mode) */}
        <div className="flex-1 min-w-0 space-y-4">
          {/* Pack-mode progress bar */}
          {mode === 'pack' && listItems.length > 0 && (
            <PackingProgress
              total={listItems.length}
              packed={listItems.filter((i) => i.is_packed).length}
              onReset={resetPacked}
              showUnpackedOnly={showUnpackedOnly}
              onToggleShowUnpackedOnly={() => setShowUnpackedOnly((v) => !v)}
              groupWorn={groupWorn}
              onToggleGroupWorn={() => setGroupWorn((v) => !v)}
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
                <WeightTable items={listItems} categories={categories} />
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
            // Uses displayedGrouped so worn items pulled into the Worn
            // section don't double-register when groupWorn is on.
            const flatItemIds = displayedGrouped.flatMap((g) => g.items.map((i) => i.id))
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
                    items={displayedGrouped.filter((g) => g.category !== null).map((g) => g.category!.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    <SortableContext items={flatItemIds} strategy={verticalListSortingStrategy}>
                      {displayedGrouped
                        .filter((g) => g.category !== null)
                        .map((group) => (
                          <SortableCategoryGroup
                            key={group.category!.id}
                            id={group.category!.id}
                            name={group.category!.name}
                            items={group.items}
                            {...sharedGroupProps}
                            onAddItem={(data) => addNewItemMut.mutate({ categoryId: group.category!.id, data })}
                          />
                        ))}
                      {displayedGrouped
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

                {/* Worn section — pack-mode only, only when toggle is on and
                    there's at least one worn item. Sits outside the DndContext
                    (drag is disabled in pack mode anyway, and the section
                    isn't a drop target). sortable=false so rows render as
                    plain ItemRow without engaging dnd-kit. The items array
                    walks categories in display order so the in-section
                    order is stable and predictable. */}
                {showWornGroup && wornItems.length > 0 && (
                  <CategoryGroup
                    name="Worn"
                    items={wornItems}
                    weightUnit={weightUnit}
                    packMode
                    sortable={false}
                    showUnpackedOnly={showUnpackedOnly}
                    onUpdate={sharedGroupProps.onUpdate}
                  />
                )}
              </div>
            )
          })()}
        </div>
      </div>

      {/* Mobile sidebar drawer — mirrors the desktop left aside. Slides
          in from the LEFT, dismissed by overlay tap, the close button,
          or a left-drag. Stays open across multiple add/remove actions
          on the gear picker so the user can build up a list quickly;
          only list selection auto-closes (then immediately navigates).
          The flex chain inside Drawer.Content uses min-h-0 on each
          flex-1 wrapper so LibraryPanel's inner overflow-y-auto can
          engage; otherwise the panel grows to its content height and
          the bounded drawer never delegates scroll to the inner list. */}
      <Drawer.Root open={drawerOpen} onOpenChange={setDrawerOpen} direction="left">
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 z-40 bg-black/40 lg:hidden" />
          <Drawer.Content className="fixed inset-y-0 left-0 z-50 flex w-[88vw] max-w-sm flex-col bg-gray-50 lg:hidden">
            <Drawer.Title className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3">
              <span className="text-sm font-semibold text-gray-900">Lists & gear</span>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                aria-label="Close sidebar"
                className="rounded p-1 text-gray-400 hover:text-gray-600"
              >
                <X size={18} />
              </button>
            </Drawer.Title>
            <div className="flex-1 min-h-0 flex flex-col gap-4 p-4 overflow-hidden">
              <ListsBox
                lists={lists}
                activeId={list.id}
                creating={dialog?.type === 'creating-list'}
                newDraft={dialog?.type === 'creating-list' ? dialog.draft : ''}
                onNewDraftChange={(v) => setDialog({ type: 'creating-list', draft: v })}
                onStartNew={() => setDialog({ type: 'creating-list', draft: '' })}
                onSubmitNew={() => {
                  const draft = dialog?.type === 'creating-list' ? dialog.draft : ''
                  const trimmed = draft.trim()
                  if (trimmed) createListMut.mutate(trimmed)
                  else setDialog(null)
                }}
                onCancelNew={() => setDialog(null)}
                onSelect={(l) => {
                  setDrawerOpen(false)
                  navigate(`/lists/${l.id}`)
                }}
                onRename={(l, name) => renameMut.mutate({ id: l.id, name })}
                onStartImport={openImportPicker}
                onExport={async (l) => {
                  const items = await qc.fetchQuery({
                    queryKey: queryKeys.listItems(l.id),
                    queryFn: () => fetchListItems(l.id),
                  })
                  const csv = listItemsToCsv(items, categories)
                  downloadCsv(`${l.name.replace(/[^a-z0-9]/gi, '-').toLowerCase() || 'list'}.csv`, csv)
                }}
                onDuplicate={(l) => duplicateMut.mutate(l)}
                onDelete={(l) => setDialog({ type: 'confirm-delete-list', list: l })}
                onReorder={(orderedIds) => {
                  reorderListsMut.mutate(orderedIds.map((id, i) => ({ id, sort_order: i })))
                }}
              />
              <div className="flex flex-col rounded-xl border border-gray-200 bg-white overflow-hidden min-h-0 flex-1">
                <div className="flex items-center px-3 py-2 border-b border-gray-200 bg-gray-50">
                  <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Gear library
                  </span>
                </div>
                <div className="flex-1 min-h-0 overflow-hidden">
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
            </div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>

      {/* Import error */}
      {dialog?.type === 'import-error' && (
        <Modal open onClose={() => setDialog(null)} title="Import error" className="w-full max-w-sm">
          <div className="p-6">
            <h2 className="text-base font-semibold text-gray-900 mb-2">Import error</h2>
            <p className="text-sm text-red-600 mb-4">{dialog.message}</p>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setDialog(null)}
                className="rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200"
              >
                Close
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Import preview */}
      {dialog?.type === 'import-preview' && (
        <ListImportPreviewDialog
          rows={dialog.rows}
          saving={importMut.isPending}
          onConfirm={() => importMut.mutate({ name: nameFromCsvFilename(dialog.filename), rows: dialog.rows })}
          onClose={() => setDialog(null)}
        />
      )}

      {/* Delete confirmation */}
      {dialog?.type === 'confirm-delete-list' && (
        <ConfirmDialog
          title="Delete list"
          message={`This will permanently delete "${dialog.list.name}" and all of its items. This cannot be undone.`}
          confirmLabel="Delete list"
          dangerous
          onCancel={() => setDialog(null)}
          onConfirm={() => {
            const target = dialog.list
            setDialog(null)
            deleteListMut.mutate(target.id)
          }}
        />
      )}

      {/* Gear-item edit (reached from the row tap on mobile or the kebab →
          Edit on any viewport). Reuses GearItemDialog and, when a list_item
          accompanies the gear item, renders an "On this list" section with
          quantity / worn / consumable controls.
          Save runs sequentially: gear first, then the per-list patch. If
          the gear write fails, nothing is applied. If the gear write
          succeeds but the list write fails, the gear changes are committed
          but the list_item is unchanged — surfaced via dialog.saveError so
          the user can retry (PATCH is idempotent on the gear side) or
          close to keep the partial result intentionally.
          updateGearItemMut already invalidates ['list-items'] (broad) so
          other lists pick up the change. */}
      {dialog?.type === 'edit-gear' && (
        <GearItemDialog
          categories={categories}
          item={dialog.gear}
          listContext={
            dialog.listItem
              ? {
                  quantity: dialog.listItem.quantity,
                  is_worn: dialog.listItem.is_worn,
                  is_consumable: dialog.listItem.is_consumable,
                }
              : undefined
          }
          saving={updateGearItemMut.isPending || updateMut.isPending}
          saveError={dialog.saveError}
          onClose={() => setDialog(null)}
          onSave={async (gearPatch, listPatch) => {
            const gearTarget = dialog.gear
            const listTarget = dialog.listItem
            // Reset prior error so the user sees fresh state for this attempt.
            // Spread the variant so we keep the targets while clearing saveError.
            setDialog({ ...dialog, saveError: null })
            try {
              await updateGearItemMut.mutateAsync({ id: gearTarget.id, patch: gearPatch })
            } catch {
              setDialog({ ...dialog, saveError: "Couldn't save gear changes. No changes were applied." })
              return
            }
            if (listPatch && listTarget) {
              try {
                await updateMut.mutateAsync({ itemId: listTarget.id, patch: listPatch })
              } catch {
                setDialog({
                  ...dialog,
                  saveError:
                    "Saved gear changes, but couldn't update this list item. Try again, or close to keep just the gear changes.",
                })
                return
              }
            }
            setDialog(null)
          }}
          onRemoveFromList={
            dialog.listItem
              ? () => {
                  const target = dialog.listItem!
                  setDialog(null)
                  deleteMut.mutate(target.id)
                }
              : undefined
          }
          onDeleteFromInventory={
            dialog.listItem
              ? () => {
                  const target = dialog.gear
                  setDialog({ type: 'delete-gear', candidate: target })
                }
              : undefined
          }
        />
      )}

      {/* Delete-from-inventory confirm (reached from the kebab). Removes the
          gear item from the library and cascades to every list_item that
          references it (ON DELETE CASCADE on gear_item_id). */}
      {dialog?.type === 'delete-gear' && (
        <ConfirmDialog
          title="Delete from inventory"
          message={`This will remove "${dialog.candidate.name}" from your inventory and from any list it appears on. This cannot be undone.`}
          confirmLabel="Delete"
          dangerous
          onCancel={() => setDialog(null)}
          onConfirm={() => {
            const target = dialog.candidate
            setDialog(null)
            deleteGearItemMut.mutate(target.id)
          }}
        />
      )}

    </div>
  )
}

