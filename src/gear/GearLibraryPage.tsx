import { useCallback, useMemo, useRef, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  closestCenter,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import { Plus, Search } from 'lucide-react'
import {
  queryKeys,
  createListFromSelection,
  reorderCategories,
  reorderGearItems,
  makeOptimisticReorder,
  fetchCategories,
} from '../lib/queries'
import { queries } from '../lib/queries/options'
import { mutationKeys } from '../lib/queries/keys'
import { gearItemsToCsv, downloadCsv } from '../lib/csv'
import { showToast } from '../lib/toast'
import UnitSegmentedControl from '../components/UnitSegmentedControl'
import type { Category, GearItem } from '../lib/types'
import { useWeightUnit } from '../lib/use-weight-unit'
import { useIsBelowLg } from '../lib/use-breakpoint'
import { useToggleSet } from '../lib/use-toggle-set'
import { runGuardedSave } from '../lib/guarded-save'
import { groupGearItemsByCategory, assignSortOrderSlots } from '../lib/grouping'
import { useReorderable } from '../lib/use-reorderable'
import { makeDnDId, parseDnDId } from '../lib/dnd-ids'
import { SortableCategorySection, StaticCategorySection } from './CategorySection'
import GearItemRow from './GearItemRow'
import GearItemDialog from '../components/gear/GearItemDialog'
import InlineCreateCategory from '../components/InlineCreateCategory'
import BulkMoveCategoryDialog from './BulkMoveCategoryDialog'
import BulkActionsToolbar from './BulkActionsToolbar'
import CreateListFromSelectionDialog from './CreateListFromSelectionDialog'
import MobileGearActionBar from './MobileGearActionBar'
import GearOptionsButton from './GearOptionsButton'
import { type GearOptionsHandlers } from './GearOptionsContent'
import ConfirmDialog from '../components/ConfirmDialog'
import StatusPanel from '../components/StatusPanel'
import { useDocumentTitle } from '../lib/use-document-title'
import { useGearImportFlow } from './use-gear-import-flow'
import { useGearItemActions } from './use-gear-item-actions'
import { useGearCategoryActions } from './use-gear-category-actions'
import { useGearBulkActions } from './use-gear-bulk-actions'
import { TOOLBAR_BUTTON } from '../components/flat-table-styles'

// `saveError` on the two GearItemDialog variants is the dialog's own failure
// surface. It is inline rather than a toast because the dialog stays open on
// failure and the error belongs beside the form (the modal rule in
// src/lib/mutation-error-handler.ts). Keeping it in the dialog STATE rather than a
// separate useState is what makes closing the dialog discard the error with it,
// and is what the save's completion guard compares identity against.
type DialogState =
  | { type: 'create-item'; saveError: string | null }
  | { type: 'edit-item'; item: GearItem; saveError: string | null }
  | { type: 'create-list-from-selection'; saveError: string | null }
  // `returnDialog` lets the confirm dialog restore the prior dialog on
  // cancel — set when the delete is launched from inside GearItemDialog
  // so the user lands back in the edit form. Omitted (undefined) for
  // deletes launched directly from the row kebab or trash icon.
  | { type: 'delete-item'; item: GearItem; returnDialog?: DialogState }
  | { type: 'delete-category'; category: Category }
  // The inline category editor is a SESSION, not a flag: `session` is the
  // editor's React key, so reopening remounts a fresh InlineCreateCategory.
  // The draft, error and in-flight state live inside that component, and a
  // create that settles after the editor was replaced (another dialog, a CSV
  // import finishing, plain close) is made inert by its unmount guard.
  | { type: 'add-category'; session: number }
  | { type: 'bulk-move' }
  | { type: 'bulk-delete' }


export default function GearLibraryPage() {
  useDocumentTitle('Gear')
  const qc = useQueryClient()

  // ── Queries ──────────────────────────────────────────────────────────────────
  // Categories: subscription + reorder state machine in one hook. The page-
  // level handleDragEnd delegates the `kind === 'category'` branch to
  // catDragEnd; the hook self-gates so the call is safe regardless of which
  // kind actually dropped. See src/lib/use-reorderable.ts for the
  // same-tick-subscription rationale.
  const {
    items: categories,
    isPending: categoriesPending,
    isLoadingError: categoriesFailed,
    refetch: retryCategories,
    reorderPending: catReorderPending,
    handleDragStart: catDragStart,
    handleDragCancel: catDragCancel,
    handleDragEnd: catDragEnd,
  } = useReorderable<Category>({
    queryKey: queryKeys.categories(),
    queryFn: fetchCategories,
    mutationFn: reorderCategories,
    dndKind: 'category',
  })
  const {
    data: allItems = [],
    isPending: gearItemsPending,
    isLoadingError: gearItemsFailed,
    refetch: refetchGearItems,
  } = useQuery(queries.gearItems())

  // Retries both halves: the failure panel does not say which one failed, so
  // the button must not either.
  const retryLibrary = useCallback(() => {
    void refetchGearItems()
    retryCategories()
  }, [refetchGearItems, retryCategories])

  // "Both halves of the library are in hand." Every gear action builds its
  // write from these two arrays, and BOTH default to [] while pending or
  // failed - so without this gate a dropped connection turns each of them into
  // a confident write against an empty library:
  //
  //   - Import dedups against nothing, so a user restoring their own CSV
  //     backup re-creates every item they already own.
  //   - Export writes a blank category cell for every row (gearItemsToCsv
  //     resolves names out of `categories`).
  //   - New item offers only "Uncategorized" and POSTs that null.
  //   - Bulk move defaults to Uncategorized and can uncategorize a selection.
  //
  // isPending + isLoadingError rather than isLoading + isError, for the reason
  // stated on the render gate below: this must be false for a cold load that
  // has not resolved, and TRUE when a background refetch failed over rows we
  // still hold - those rows are good, and the actions above are safe on them.
  const libraryReady = !gearItemsPending && !gearItemsFailed && !categoriesPending && !categoriesFailed

  // The create-list-from-selection dialog needs the existing list count for
  // its LIST_CAP warning. Subscribe via `select` so this page re-renders on
  // count changes only, instead of holding every list row for a rarely-read
  // value. Shares the ['lists'] cache with the lists pages.
  const { data: listCount = 0 } = useQuery({
    ...queries.lists(),
    select: (lists) => lists.length,
  })

  // O(1) id lookups for DnD callbacks and DragOverlay rendering. See
  // ListDetailPage's listItemsById comment for the rationale.
  const allItemsById = useMemo(
    () => new Map(allItems.map((i) => [i.id, i])),
    [allItems],
  )

  // ── Local state ───────────────────────────────────────────────────────────────
  const [search, setSearch] = useState('')
  // The rows matching the search: what the category sections render and what
  // a within-category drag plans against. Declared up here, ahead of the drag
  // handler that reads it.
  const searchFiltered = useMemo(() => {
    if (!search) return allItems
    const q = search.toLowerCase()
    return allItems.filter((i) => i.name.toLowerCase().includes(q))
  }, [allItems, search])
  const [dialog, setDialog] = useState<DialogState | null>(null)
  const [selectMode, setSelectMode] = useState(false)
  const { set: selectedIds, toggle: toggleSelect, clear: clearSelected, reset: resetSelected } = useToggleSet<string>()
  const { set: collapsed, toggle: toggleCollapse, clear: expandAll, reset: resetCollapsed } = useToggleSet<string>()
  const { weightUnit } = useWeightUnit()
  const isBelowLg = useIsBelowLg()
  // Monotonic id for each opening of the inline category editor, used as its
  // React key: opening "New category" while the editor is already up remounts
  // it with a clean draft and detaches any create still in flight.
  const categorySessionRef = useRef(0)
  const openNewCategory = (): DialogState => ({
    type: 'add-category',
    session: (categorySessionRef.current += 1),
  })
  // The GearItemDialog save currently awaiting a response, held as the exact
  // DialogState object it was submitted from. Two jobs, both identity-based:
  // `saving` is true only while THIS dialog's own save is out (addItem/editItem
  // .isPending would also light up for an inline row edit happening behind the
  // dialog), and a completion whose attempt is no longer the open dialog is
  // discarded rather than applied to whatever is on screen now.
  const [savingAttempt, setSavingAttempt] = useState<DialogState | null>(null)

  function exitSelectMode() {
    setSelectMode(false)
    clearSelected()
  }

  function closeNewCategory() {
    setDialog(null)
  }

  // The async way out of the editor, for its success callback ONLY (the user's
  // own Escape/X goes through closeNewCategory above, unconditionally). A
  // create can settle in the same tick as a replacement update that is
  // already QUEUED but not yet committed - a CSV parse finishing closes the
  // editor through the import flow's onBeforeOpen, and the editor is inline,
  // so another dialog can be opened over a create still in flight - and the
  // component's unmount guard cannot see a queued update. This functional
  // update decides against whatever is open NOW, queued replacements
  // included, so a late success can never discard one.
  function closeCategorySession(session: number) {
    setDialog((prev) =>
      prev?.type === 'add-category' && prev.session === session ? null : prev,
    )
  }

  // ── CSV import/export ─────────────────────────────────────────────────────────
  // The whole import flow (explainer, file input, preview, POST, error
  // dialog) lives in the hook; onBeforeOpen clears this page's dialog union
  // whenever the flow opens one of ITS dialogs, so the two state machines
  // never both hold a surface - the same coordination the shared union used
  // to provide when the import dialogs were variants of it.
  const { openImportExplainer, importUi } = useGearImportFlow({
    categories,
    allItems,
    onBeforeOpen: () => setDialog(null),
  })

  function handleExport() {
    try {
      const csv = gearItemsToCsv(allItems, categories)
      downloadCsv('gear-library.csv', csv)
    } catch {
      showToast("Couldn't export the gear library. Please try again.", { type: 'error' })
    }
  }

  // ── Mutations ─────────────────────────────────────────────────────────────────
  // Category write actions (add / rename / delete) live in a dedicated hook; it
  // owns the optimistic insert/update/delete, including the delete's cross-cache
  // invalidation that re-renders gear/list views after the DB sets the affected
  // gear_items.categoryId to NULL. The page keeps category reorder (in the
  // useReorderable hook), the InlineCreateCategory wiring, and the stable handler
  // layer that feeds memoized sections (it destructures renameCategory.mutate /
  // removeCategory.mutate below).
  const { addCategory, renameCategory, removeCategory } = useGearCategoryActions(categories)

  // Gear-item write actions (add / edit / delete) live in a dedicated hook; it
  // owns the optimistic insert and the gear-specific fan-out update/delete
  // lifecycle. The page keeps the dialog state, the stable handler layer that
  // feeds memoized rows/sections (it destructures editItem.mutate below), and
  // the add/edit/delete dialogs close at the mutate call site.
  const { addItem, editItem, removeItem } = useGearItemActions(allItems)

  // Bulk gear write actions (delete selected / move selected to a category) live
  // in a dedicated hook; it owns the gear-specific bulk fan-out lifecycle and the
  // failure toast. The page keeps selection UI state (selectMode / selectedIds /
  // exitSelectMode); select mode is exited on success at the mutate call site,
  // so the hook never touches selection state. The move dialog and the delete
  // confirm close on the click, before the write settles, so a failure toast
  // is not hidden.
  const { bulkDelete, bulkMove } = useGearBulkActions()

  // Create a list from the current selection. The server assigns the new
  // list's sort slot and inserts the membership rows atomically (one
  // transaction; any foreign gear id rejects the whole call), so the client just
  // posts name + description + ids and navigates into the result.
  const navigate = useNavigate()
  // No meta.errorToast, deliberately, even though this is a NON-optimistic mutation
  // - the case the toast mechanism exists for. Its dialog stays open on failure and
  // is a modal, so the error goes inline, beside the form. (The toast this used to
  // raise expired behind the backdrop, before toasts rendered over modals, and the
  // create failed silently.) See the rule in src/lib/mutation-error-handler.ts.
  const createListFromSelectionMut = useMutation({
    mutationKey: mutationKeys.createListFromSelection(),
    mutationFn: createListFromSelection,
    onSuccess: (newList) => {
      void qc.invalidateQueries({ queryKey: queryKeys.lists() })
      void qc.invalidateQueries({ queryKey: queryKeys.listItems(newList.id) })
      setDialog(null)
      exitSelectMode()
      void navigate(`/lists/${newList.id}`)
    },
  })

  // ── Drag and drop ─────────────────────────────────────────────────────────────
  // See ListDetailPage for the rationale. MouseSensor drives the desktop
  // hover grip (gear item rows) and the always-visible category-header grip;
  // TouchSensor's press-and-hold drives touch reorder without stealing taps
  // (open edit dialog) or vertical scroll. Category headers keep their
  // dedicated visible grip on mobile, so long-press on that grip reorders
  // categories; gear item rows use the row itself as the touch activator.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  // When dragging a category, the dragged wrapper carries its items along
  // (they're DOM children). closestCenter measures from the active's center,
  // and the dragged category's own item rects are physically closest — so
  // `over` resolves to one of the dragged category's own items, the handler
  // resolves dest to the same category, and the drop snaps back. Filter the
  // collision search to category droppables when the active is a category;
  // item drags use closestCenter unchanged. The kind tag in the typed id
  // (see src/lib/dnd-ids.ts) is what tells us which case we're in.
  const collisionDetection = useMemo<CollisionDetection>(
    () => (args) => {
      const activeKind = parseDnDId(String(args.active.id))?.kind
      if (activeKind === 'category') {
        return closestCenter({
          ...args,
          droppableContainers: args.droppableContainers.filter(
            (c) => parseDnDId(String(c.id))?.kind === 'category',
          ),
        })
      }
      return closestCenter(args)
    },
    [],
  )

  // Active drag id (item id OR category id). The DragOverlay renders an
  // item-row clone for item drags; category drag falls back to dnd-kit's
  // default (original element follows the cursor) since the active id
  // isn't in the inner items SortableContext.
  const [activeId, setActiveId] = useState<string | null>(null)

  // Within-category sort drag for gear items. Updates gear_items.sort_order
  // for the affected category via PUT /api/gear-items/order — single
  // round-trip, applied all-or-nothing on the server, same write path as
  // categories. Optimistic via makeOptimisticReorder on ['gear-items'].
  const reorderGearItemsMut = useMutation({
    mutationKey: mutationKeys.reorderGearItems(),
    mutationFn: reorderGearItems,
    ...makeOptimisticReorder<GearItem>(qc, queryKeys.gearItems()),
  })

  // The page tracks its OWN activeId for the gear-item DragOverlay clone
  // (the DragOverlay below only renders gear-item rows; categories don't
  // have a clone). The categories useReorderable hook tracks an independent
  // activeId internally for its own state machine; we forward the lifecycle
  // events to it so it stays in sync even though its activeItem isn't
  // consumed at this surface.
  function handleDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id))
    catDragStart(e)
  }

  function handleDragCancel() {
    setActiveId(null)
    catDragCancel()
  }

  // Page-level drag handler. Two cases:
  //   1. Reorder categories themselves — delegated to the categories
  //      useReorderable hook (`catDragEnd`). The hook owns parse/validate/
  //      arrayMove/slot assignment/mutate. We early-return on kind=='category'
  //      so the gear-item branch below doesn't also fire against a
  //      category id.
  //   2. Reorder items within their existing category — stays page-level
  //      because the algebra is slice-based (filter to category, then
  //      arrayMove). The useReorderable hook is flat-only by design; a
  //      future second-pass extraction may take a groupBy option, but the
  //      shape isn't proven yet.
  //
  // Cross-category gear-item drops are deliberately rejected (item snaps
  // back); recategorizing happens via the edit modal or the multi-select
  // bulk-move toolbar, where the target is named rather than inferred from
  // drop position.
  function handleDragEnd(e: DragEndEvent) {
    setActiveId(null)
    const { active, over } = e
    if (!over) return
    if (active.id === over.id) return

    const activeParsed = parseDnDId(String(active.id))
    const overParsed = parseDnDId(String(over.id))
    if (!activeParsed || !overParsed) return

    // Case 1 — category reorder.
    if (activeParsed.kind === 'category') {
      catDragEnd(e)
      return
    }

    // Case 2 — within-category gear-item reorder. The drop target must be
    // another gear-item AND in the same category as the dragged item.
    if (activeParsed.kind !== 'gear-item' || overParsed.kind !== 'gear-item') return
    const activeItem = allItemsById.get(activeParsed.id)
    if (!activeItem) return
    const overItem = allItemsById.get(overParsed.id)
    if (!overItem) return
    const activeCat = activeItem.categoryId ?? null
    const overCat = overItem.categoryId ?? null
    if (overCat !== activeCat) return

    // Planned against the rows matching the search, the sequence the user is
    // dragging within. Search hides rows without moving them, and counting a
    // hidden row would compute the move against rows not on screen and
    // rewrite that row's position. assignSortOrderSlots permutes only these
    // rows' own slots, so hidden rows keep theirs; a hidden endpoint is not in
    // the slice, so its drag writes nothing.
    const itemsInCat = searchFiltered.filter((i) => (i.categoryId ?? null) === activeCat)
    const oldIndex = itemsInCat.findIndex((i) => i.id === activeParsed.id)
    const newIndex = itemsInCat.findIndex((i) => i.id === overParsed.id)
    if (oldIndex === -1 || newIndex === -1) return
    const reordered = arrayMove(itemsInCat, oldIndex, newIndex)
    reorderGearItemsMut.mutate(assignSortOrderSlots(reordered))
  }

  // ── Derived data ──────────────────────────────────────────────────────────────
  // After removing category chips, search is the only narrowing filter on
  // the page. Empty categories still render as section headers so the user
  // can use them as drop targets / "+ Add item" affordances.
  const groups = useMemo(
    () => groupGearItemsByCategory(searchFiltered, categories),
    [searchFiltered, categories],
  )

  // Stable list of every collapsible key currently rendered — real category
  // ids plus '__uncategorized__' when that bucket is non-empty. Mirrors the
  // key derivation the per-category collapse trigger uses, so the bulk
  // collapse/expand affordances target exactly what's on screen.
  const collapsibleKeys = useMemo(
    () => groups.map((g) => g.category?.id ?? '__uncategorized__'),
    [groups],
  )

  // ── Stable row/section handlers ────────────────────────────────────────────────
  // One identity per action, each taking the entity it acts on, so the memoized
  // CategorySection / SortableGearItemRow barriers are not busted by fresh
  // per-render closures. (toggleSelect / toggleCollapse from useToggleSet are
  // already stable and are passed through directly.)
  //
  // Destructure the mutate fns: TanStack's `mutate` is referentially stable
  // across renders, so depending on it (not the whole mutation object, which is
  // a fresh object each render) keeps these callbacks stable - which is the
  // whole point. exhaustive-deps is satisfied by the destructured identifiers.
  const { mutate: editItemMutate } = editItem
  const { mutate: renameCategoryMutate } = renameCategory
  const handleInlineSave = useCallback(
    (id: string, patch: Partial<Pick<GearItem, 'name' | 'description' | 'weightGrams'>>) =>
      editItemMutate({ id, patch }),
    [editItemMutate],
  )
  const handleEditItem = useCallback((item: GearItem) => setDialog({ type: 'edit-item', item, saveError: null }), [])
  const handleDeleteItem = useCallback((item: GearItem) => setDialog({ type: 'delete-item', item }), [])
  const handleSetItemStatus = useCallback(
    (id: string, status: GearItem['status']) => editItemMutate({ id, patch: { status } }),
    [editItemMutate],
  )
  const handleRenameCategory = useCallback(
    (id: string, name: string) => renameCategoryMutate({ id, name }),
    [renameCategoryMutate],
  )
  const handleDeleteCategory = useCallback(
    (cat: Category) => setDialog({ type: 'delete-category', category: cat }),
    [],
  )

  // The one options bundle, consumed by both Options surfaces (the desktop
  // GearOptionsButton popover and MobileGearActionBar's modal). These used
  // to be twin 8-prop lists kept in lockstep by hand.
  const gearOptions: GearOptionsHandlers = {
    onNewCategory: () => setDialog(openNewCategory()),
    onImport: openImportExplainer,
    onExport: handleExport,
    canExport: libraryReady && allItems.length > 0,
    onCollapseAll: () => resetCollapsed(collapsibleKeys),
    onExpandAll: expandAll,
    canCollapseExpand: collapsibleKeys.length > 0,
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="print:pb-0">
      {/* The import flow's hidden file input and dialogs. */}
      {importUi}
      {/* Page header. Both viewports expose only the
          frequent actions (search + New item + Select + Options);
          rare/utility actions (New category, Collapse / Expand all) live
          behind the Options surface — a desktop popover
          (GearOptionsButton) and a mobile modal (MobileGearActionBar).
          The two surfaces consume the same GearOptionsContent so the
          row list stays in lockstep. */}
      <div className="mb-6 space-y-3">
        <div className="flex items-baseline gap-2">
          <h1 className="text-xl font-semibold text-gray-900">Gear</h1>
          <span className="text-sm text-gray-500">{allItems.length} items</span>
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-3">
          {/* Search — fills the remaining mobile-row width (flex-1
              min-w-0) so it isn't squeezed; locks to a comfortable
              fixed width at md+ so the right-side cluster has room. */}
          <div className="relative flex-1 min-w-0 md:flex-none md:w-56">
            <label className="sr-only" htmlFor="gear-library-search">Search gear</label>
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              id="gear-library-search"
              type="search"
              placeholder="Search…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-gray-300 pl-8 pr-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Inline "New category" editor — only mounted while the
              add-category dialog state is active. Triggered from either the
              desktop Options popover or the mobile Options modal; visible
              full-width on mobile, inline on desktop. The shared component
              (also used inside GearItemDialog) owns the draft, the pending
              guard and the late-answer protection. */}
          {dialog?.type === 'add-category' && (
            <InlineCreateCategory
              key={dialog.session}
              variant="toolbar"
              create={(categoryName) => addCategory.mutateAsync(categoryName)}
              onCreated={() => closeCategorySession(dialog.session)}
              onCancel={closeNewCategory}
            />
          )}

          {/* Select pill — visible on every viewport. Frequent enough on
              mobile (bulk Move / Delete / Create List From Selection) that
              hiding it behind the Options modal would degrade discovery;
              also doesn't belong on the universal mobile bottom bar since
              it's gear-specific. md:ml-auto pushes it (and the desktop
              cluster) to the right edge of the header row; on mobile it
              sits inline next to search. */}
          {selectMode ? (
            <button
              onClick={exitSelectMode}
              className={`md:ml-auto ${TOOLBAR_BUTTON}`}
            >
              Cancel
            </button>
          ) : (
            <button
              onClick={() => setSelectMode(true)}
              // Gating ENTRY, never Cancel above: selection is the doorway to
              // bulk move and bulk delete, both of which write against the
              // library snapshot. Disabling the way out of a mode the user is
              // already in would trap them.
              disabled={!libraryReady}
              className={`md:ml-auto ${TOOLBAR_BUTTON}`}
            >
              Select
            </button>
          )}

          {/* Every row on this page shows a weight, so the page carries the
              unit switcher - and for an account with gear but no lists yet
              it is the ONLY authenticated surface that can (the other lives
              on the list toolbar; Settings deliberately has none). Visible
              at every viewport, never gated on libraryReady: the preference
              is device-local and the zero-data account needs it most. */}
          <UnitSegmentedControl idPrefix="gear-toolbar" />

          {/* Right cluster — New item + Options. Shown only at >=lg; below
              lg the MobileGearActionBar's Add slot and Options modal own
              these actions. lg (not md) matches the bar's lg:hidden, so the
              two never coexist (md:flex left New item + bar Add both visible
              at 768-1023px). Select is lifted out so it stays discoverable
              on every viewport. Create is a page-level modal, unaffected by
              this breakpoint. */}
          <div className="hidden lg:flex items-center gap-2">
            <button
              onClick={() => setDialog({ type: 'create-item', saveError: null })}
              disabled={!libraryReady}
              className={`flex items-center gap-1.5 ${TOOLBAR_BUTTON}`}
            >
              <Plus size={14} />
              New item
            </button>
            <GearOptionsButton libraryReady={libraryReady} gearOptions={gearOptions} />
          </div>
        </div>

      </div>

      {/* Sticky bulk-action bar — shown only in selection mode. Sits between
          the page header and the category list so it sticks to the top of the
          gear list area as the user scrolls. */}
      {selectMode && (
        <BulkActionsToolbar
          selectedCount={selectedIds.size}
          selectableTotal={searchFiltered.length}
          onClose={exitSelectMode}
          onSelectAll={() => resetSelected(searchFiltered.map((i) => i.id))}
          onDeselectAll={clearSelected}
          onCreateList={() => setDialog({ type: 'create-list-from-selection', saveError: null })}
          busy={bulkDelete.isPending || bulkMove.isPending}
          onMoveToCategory={() => setDialog({ type: 'bulk-move' })}
          onDelete={() => setDialog({ type: 'bulk-delete' })}
        />
      )}

      {/* Category list.
          Failure is checked BEFORE loading, and both are checked before the
          empty state, because the empty state makes a claim the other two
          cannot support: "you own no gear yet".
          isLoadingError, not isError: in v5 a failed BACKGROUND refetch sets
          status to 'error' while KEEPING the cached rows, and every gear
          mutation invalidates this key - so bare isError would replace a fully
          rendered library with a failure line after any post-write blip.
          isPending, not isLoading: v5's isLoading is `isPending && isFetching`,
          so a cold load with the browser offline parks at fetchStatus 'paused'
          and reports isLoading FALSE with zero rows. That fell through to the
          empty state below, which greeted an offline user who owns 200 items
          with the brand-new-user onboarding pitch. Same class of bug as PR 4.1
          on /lists. */}
      {gearItemsFailed || categoriesFailed ? (
        <StatusPanel
          title="Couldn't load your gear"
          body="Check your connection and try again."
          onRetry={retryLibrary}
        />
      ) : gearItemsPending || categoriesPending ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : allItems.length === 0 && categories.length === 0 ? (
        <GearLibraryEmptyState
          onCreateItem={() => setDialog({ type: 'create-item', saveError: null })}
          onImport={openImportExplainer}
          onCreateCategory={() => setDialog(openNewCategory())}
        />
      ) : search.trim() !== '' && searchFiltered.length === 0 ? (
        <p className="text-sm text-gray-500">
          No gear matches &ldquo;{search}&rdquo;.
        </p>
      ) : (() => {
        const activeParsed = activeId ? parseDnDId(activeId) : null
        const activeItem =
          activeParsed?.kind === 'gear-item' ? (allItemsById.get(activeParsed.id) ?? null) : null
        return (
          <div className="flex flex-col gap-3">
          <DndContext
            sensors={sensors}
            collisionDetection={collisionDetection}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
          >
            {/* Categories SortableContext at the page level — its items list
                is the category ids, so SortableCategorySection's useSortable
                resolves to it. Each CategorySection renders a per-category
                SortableContext internally for its items. */}
            <SortableContext
              items={categories.map((c) => makeDnDId('category', c.id))}
              strategy={verticalListSortingStrategy}
            >
              {groups.map((group) => {
                // All callbacks below are stable identities (see the handlers
                // declared above + useToggleSet); the only per-render-varying
                // values are the ones that SHOULD re-render a section: this
                // group's items / collapsed / selection state. That is what
                // makes memo(CategorySection) a real barrier. Quick status
                // change shares editItem so optimistic fan-out into open
                // ['list-items'] caches stays consistent with the dialog path.
                const commonProps = {
                  items: group.items,
                  weightUnit,
                  isBelowLg,
                  collapsed: collapsed.has(group.category?.id ?? '__uncategorized__'),
                  onToggleCollapse: toggleCollapse,
                  selectMode,
                  selectedIds,
                  onToggleSelect: toggleSelect,
                  onInlineSave: handleInlineSave,
                  onEditItem: handleEditItem,
                  onDeleteItem: handleDeleteItem,
                  onSetItemStatus: handleSetItemStatus,
                  onRenameCategory: handleRenameCategory,
                  onDeleteCategory: handleDeleteCategory,
                  itemReorderPending: reorderGearItemsMut.isPending,
                }

                if (group.category === null) {
                  return (
                    <StaticCategorySection key="__uncategorized__" category={null} {...commonProps} />
                  )
                }
                return (
                  <SortableCategorySection
                    key={group.category.id}
                    id={group.category.id}
                    category={group.category}
                    reorderPending={catReorderPending}
                    {...commonProps}
                  />
                )
              })}
            </SortableContext>
            <DragOverlay dropAnimation={null}>
              {activeItem ? (
                <GearItemRow
                  item={activeItem}
                  weightUnit={weightUnit}
                  isBelowLg={isBelowLg}
                  selectMode={false}
                  selected={false}
                  onToggleSelect={() => {}}
                  onInlineSave={() => {}}
                  onEdit={() => {}}
                  onDelete={() => {}}
                  onSetStatus={() => {}}
                />
              ) : null}
            </DragOverlay>
          </DndContext>
          </div>
        )
      })()}

      {/* Dialogs */}
      {(dialog?.type === 'create-item' || dialog?.type === 'edit-item') && (
        <GearItemDialog
          key={dialog.type === 'edit-item' ? dialog.item.id : 'new'}
          categories={categories}
          item={dialog.type === 'edit-item' ? dialog.item : undefined}
          saving={savingAttempt === dialog}
          saveError={dialog.saveError}
          onClose={() => setDialog(null)}
          onCreateCategory={(categoryName) => addCategory.mutateAsync(categoryName)}
          onSave={(gearPatch) => {
            // Gear library page never opens the dialog with a list context,
            // so listPatch is always null here and is ignored.
            //
            // The dialog stays dismissable while this runs, so the completion
            // goes through runGuardedSave's identity guard (see
            // src/lib/guarded-save.ts). Installing `attempt` also clears any
            // error from the previous try.
            const attempt: DialogState = { ...dialog, saveError: null }
            runGuardedSave<DialogState>({
              attempt,
              setState: setDialog,
              setSaving: setSavingAttempt,
              run: async (settle) => {
                try {
                  if (attempt.type === 'edit-item') {
                    await editItem.mutateAsync({ id: attempt.item.id, patch: gearPatch })
                  } else {
                    await addItem.mutateAsync(gearPatch)
                  }
                  settle(() => null)
                } catch {
                  // mutateAsync rejects only after the optimistic helper has rolled
                  // back, so by here the caches are already consistent and there is
                  // nothing to undo - just something to say. Catching is also what
                  // keeps this off the unhandled-rejection path.
                  settle((prev) => ({
                    ...prev,
                    // Create and edit diverge, and the reason is retry safety rather
                    // than tone. The edit is a PATCH: repeating it converges, so
                    // "try again" is sound advice. The create is a POST that mints
                    // an id, so if the server committed and the response was lost, a
                    // blind retry adds the item twice - and a rejected request is
                    // never proof the server did not commit (apiFetch also rejects
                    // when a 200 fails DTO validation).
                    saveError:
                      attempt.type === 'edit-item'
                        ? "Couldn't confirm those changes saved. Try again, or refresh to check."
                        : "Couldn't confirm the item was created. Refresh before retrying, in case it was.",
                  }))
                }
              },
            })
          }}
          // Mobile-only Delete from inventory action inside the dialog.
          // Replaces the trash icon that used to sit in the row on desktop
          // (still present on lg+ via the inline RowIconButton). Hands off
          // to the same delete-item ConfirmDialog flow as the desktop
          // trash button by transitioning dialog state.
          onDeleteFromInventory={
            dialog.type === 'edit-item'
              ? () => setDialog({ type: 'delete-item', item: dialog.item, returnDialog: dialog })
              : undefined
          }
        />
      )}

      {dialog?.type === 'delete-item' && (
        <ConfirmDialog
          title="Delete from inventory"
          message={`This will remove "${dialog.item.name}" from your inventory and from any list it appears on. This cannot be undone.`}
          confirmLabel="Delete"
          dangerous
          // Cancel restores the prior dialog when one was captured (the
          // user launched delete from inside GearItemDialog). Otherwise
          // close to the page.
          onCancel={() => setDialog(dialog.returnDialog ?? null)}
          // Close first, then mutate - the same order every delete confirm in the
          // lists code already uses. The delete is optimistic, so the row is gone
          // the instant this runs and a modal sitting over a list that already
          // reflects the deletion is just in the way. (It also used to be what kept
          // the rollback's failure toast from expiring unseen behind the confirm,
          // before toasts rendered over modals.)
          onConfirm={() => {
            const target = dialog.item
            setDialog(null)
            removeItem.mutate(target.id)
          }}
        />
      )}

      {dialog?.type === 'bulk-delete' && (
        <ConfirmDialog
          title="Delete selected items"
          message={`This will remove ${selectedIds.size} ${selectedIds.size === 1 ? 'item' : 'items'} from your inventory and from any list they appear on. This cannot be undone.`}
          confirmLabel="Delete"
          dangerous
          onCancel={() => setDialog(null)}
          // Close-then-mutate, as the single-item delete does. Select mode stays
          // until success, so a failed delete leaves the selection to retry.
          onConfirm={() => {
            setDialog(null)
            bulkDelete.mutate(Array.from(selectedIds), { onSuccess: exitSelectMode })
          }}
        />
      )}

      {dialog?.type === 'delete-category' && (
        <ConfirmDialog
          title="Delete category"
          message={`Delete "${dialog.category.name}"? Items in this category will become uncategorized.`}
          confirmLabel="Delete"
          dangerous
          onCancel={() => setDialog(null)}
          // Close-then-mutate, same rationale as the delete-item confirm above.
          onConfirm={() => {
            const target = dialog.category
            setDialog(null)
            removeCategory.mutate(target.id)
          }}
        />
      )}

      {dialog?.type === 'create-list-from-selection' && (
        <CreateListFromSelectionDialog
          selectedCount={selectedIds.size}
          existingListCount={listCount}
          saving={createListFromSelectionMut.isPending}
          saveError={dialog.saveError}
          onSubmit={(name, description) => {
            // Same identity guard as the gear dialog above, so an error arriving
            // after the user closed the dialog cannot re-open it. No saving slot:
            // this mutation serves only this dialog, so its isPending is accurate.
            // Success is handled by the mutation's own onSuccess, which navigates
            // away.
            const attempt: DialogState = { ...dialog, saveError: null }
            runGuardedSave<DialogState>({
              attempt,
              setState: setDialog,
              run: async (settle) => {
                try {
                  await createListFromSelectionMut.mutateAsync({
                    name,
                    description,
                    gearItemIds: Array.from(selectedIds),
                  })
                } catch {
                  settle((prev) => ({
                    ...prev,
                    saveError:
                      "Couldn't confirm the list was created. Refresh before retrying, in case it was.",
                  }))
                }
              },
            })
          }}
          onClose={() => setDialog(null)}
        />
      )}

      {dialog?.type === 'bulk-move' && (
        <BulkMoveCategoryDialog
          categories={categories}
          count={selectedIds.size}
          onMove={(categoryId) => {
            // Close on the click: the move is optimistic, so the rows have
            // already moved and the dialog has nothing left to show. Select mode
            // waits for success so a failed move leaves the selection in place
            // to retry.
            setDialog(null)
            bulkMove.mutate({ ids: Array.from(selectedIds), categoryId }, { onSuccess: exitSelectMode })
          }}
          onClose={() => setDialog(null)}
        />
      )}

      {/* Mobile bottom action bar — uniform Gear / Lists / Add / Options
          shape shared with every other mobile bar. Select lives on the
          page header now (visible on all viewports) so it stays
          discoverable without taking a bottom-bar slot. lg:hidden inside
          the component itself, so desktop never renders. */}
      <MobileGearActionBar
        libraryReady={libraryReady}
        onNewItem={() => setDialog({ type: 'create-item', saveError: null })}
        gearOptions={gearOptions}
      />
    </div>
  )
}

function GearLibraryEmptyState({
  onCreateItem,
  onImport,
  onCreateCategory,
}: {
  onCreateItem: () => void
  onImport: () => void
  onCreateCategory: () => void
}) {
  return (
    <section className="rounded-lg border border-dashed border-gray-300 bg-white px-5 py-8 text-center">
      <h2 className="text-base font-semibold text-gray-900">No gear yet</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-gray-500">
        Add your first item, import a CSV, or create a category to start organizing your gear library.
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <button
          type="button"
          onClick={onCreateItem}
          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          <Plus size={16} />
          Add item
        </button>
        <button
          type="button"
          onClick={onImport}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Import CSV
        </button>
        <button
          type="button"
          onClick={onCreateCategory}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          New category
        </button>
      </div>
    </section>
  )
}
