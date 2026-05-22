import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useNavigate } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  DndContext,
  DragOverlay,
  closestCenter,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { CopyPlus, Download, Globe, GripVertical, MoreVertical, Pencil, Plus, Trash2, Upload, X } from 'lucide-react'
import { useRequireSession } from '../auth/use-require-session'
import {
  queryKeys,
  fetchLists,
  fetchListItems,
  fetchGearItems,
  fetchCategories,
  createList,
  updateList,
  deleteList,
  duplicateList,
  reorderLists,
  importCsvRowsToList,
  makeOptimisticReorder,
  makeOptimisticInsert,
  makeOptimisticUpdate,
  makeOptimisticDelete,
} from '../lib/queries'
import { assignSortOrderSlots } from '../lib/grouping'
import { asButtonRef } from '../lib/dnd'
import { makeDnDId, parseDnDId } from '../lib/dnd-ids'
import type { List } from '../lib/types'
import { parseListCsv, listItemsToCsv, downloadCsv, nameFromCsvFilename, type ListImportRow } from '../lib/csv'
import { useCsvFileInput } from '../lib/use-csv-file-input'
import { useDocumentTitle } from '../lib/use-document-title'
import { useNow } from '../lib/use-now'
import { optimisticListPlaceholder } from '../lib/optimistic-list-placeholder'
import { useAnchoredMenu } from '../lib/use-anchored-menu'
import ConfirmDialog from '../components/ConfirmDialog'
import Modal from '../components/Modal'
import PrimaryButton from '../components/PrimaryButton'
import ListImportPreviewDialog from './ListImportPreviewDialog'
import ListsEmptyState from './ListsEmptyState'
import PrivacyPanel from './PrivacyPanel'
import MobileListsActionBar from './MobileListsActionBar'

// Single discriminated union for every transient dialog/modal/inline-form on
// this page. Mirrors the pattern in ListDetailPage / GearLibraryPage — `type`
// discriminator, `null` for the closed state.
type DialogState =
  | { type: 'creating'; draft: string }
  | { type: 'renaming'; list: List; draft: string }
  | { type: 'confirm-delete'; list: List }
  | { type: 'share-list'; list: List }
  | { type: 'import-preview'; rows: ListImportRow[]; filename: string }
  | { type: 'import-error'; message: string }

export default function ListsPage() {
  useDocumentTitle('Lists')
  const auth = useRequireSession()
  const navigate = useNavigate()
  const qc = useQueryClient()
  // Page-level clock for the per-card "X min ago" displays. One interval
  // for the whole grid; cards consume it via a `now` prop. M9 fix.
  const now = useNow(60_000)

  // PrivateRoute keeps session non-null in the steady state, but it can flip
  // to null mid-render during sign-out. Resolve a userId once at the top of
  // the component, falling back to '' — every mutation is gated on `session`
  // being present at render time before being invoked, so the empty string
  // is never sent to the server through a mutation. The owner-scoped private
  // queries below pass userId as the user_id filter; an empty string returns
  // empty results rather than the unfiltered union, which is the safer
  // race-window behavior.
  const userId = auth?.userId ?? ''

  const { data: lists = [], isLoading: listsLoading } = useQuery({
    queryKey: queryKeys.lists(),
    queryFn: () => fetchLists(userId),
  })
  // Gear/categories needed by importCsvRowsToList. They're already cached when
  // the user navigates here from elsewhere; otherwise the query runs in the
  // background and resolves before the user can confirm an import.
  const { data: gearItems = [] } = useQuery({
    queryKey: queryKeys.gearItems(),
    queryFn: () => fetchGearItems(userId),
  })
  const { data: categories = [] } = useQuery({
    queryKey: queryKeys.categories(),
    queryFn: () => fetchCategories(userId),
  })

  const [dialog, setDialog] = useState<DialogState | null>(null)

  const {
    inputRef: importInputRef,
    onChange: handleImportFile,
    openPicker: openImportPicker,
  } = useCsvFileInput<ListImportRow>(parseListCsv, {
    onParsed: (rows, filename) => setDialog({ type: 'import-preview', rows, filename }),
    onError: (message) => setDialog({ type: 'import-error', message }),
  })

  const createListMut = useMutation({
    mutationFn: (name: string) => createList(userId, name, lists.length),
    ...makeOptimisticInsert<List, string>({
      qc,
      queryKey: queryKeys.lists(),
      // The settled refetch replaces the placeholder with the server
      // row carrying its own generated slug. Helper emits DB-valid
      // uuid + 6-char slug so an accidental persist would fail soft
      // (silent no-op) instead of hitting a 23514 / 22P02.
      optimistic: (name) => optimisticListPlaceholder({ name, userId, sortOrder: lists.length }),
    }),
    // Helper provides onSettled (invalidate); onSuccess runs first to
    // close the create dialog and navigate to the new list.
    onSuccess: (created) => {
      setDialog(null)
      navigate(`/lists/${created.id}`)
    },
  })

  const renameMut = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => updateList(id, { name }),
    ...makeOptimisticUpdate<List, { id: string; name: string }>({
      qc,
      queryKey: queryKeys.lists(),
      id: ({ id }) => id,
      apply: (item, { name }) => ({
        ...item,
        name,
        updated_at: new Date().toISOString(),
      }),
    }),
  })

  const duplicateMut = useMutation({
    mutationFn: (target: List) => duplicateList(target, userId, lists.length),
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: queryKeys.lists() })
      navigate(`/lists/${created.id}`)
    },
  })

  const deleteListMut = useMutation({
    mutationFn: deleteList,
    ...makeOptimisticDelete<List, string>({
      qc,
      queryKey: queryKeys.lists(),
      id: (id) => id,
    }),
  })

  const reorderListsMut = useMutation({
    mutationFn: reorderLists,
    ...makeOptimisticReorder<List>(qc, queryKeys.lists()),
  })

  // See ListDetailPage for the rationale. List cards keep their always-
  // visible grip handle as the drag activator on every breakpoint, so on
  // touch a long-press on the grip starts the reorder (MouseSensor handles
  // the desktop mouse drag). Splitting mouse/touch here keeps this page on
  // the same sensor set as the item-row pages.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const [activeId, setActiveId] = useState<string | null>(null)

  function handleDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id))
  }

  function handleDragCancel() {
    setActiveId(null)
  }

  // Row-level reorder. Rows are stacked vertically inside a single
  // container, so verticalListSortingStrategy is the right collision
  // model — predicts target purely by Y axis. The DnD kind is still
  // `list-card` (an internal identifier); only the visual shape changed.
  function handleDragEnd(e: DragEndEvent) {
    setActiveId(null)
    const { active, over } = e
    if (!over) return
    if (active.id === over.id) return
    const activeParsed = parseDnDId(String(active.id))
    const overParsed = parseDnDId(String(over.id))
    if (!activeParsed || !overParsed) return
    if (activeParsed.kind !== 'list-card' || overParsed.kind !== 'list-card') return
    const oldIndex = lists.findIndex((l) => l.id === activeParsed.id)
    const newIndex = lists.findIndex((l) => l.id === overParsed.id)
    if (oldIndex === -1 || newIndex === -1) return
    const reordered = arrayMove(lists, oldIndex, newIndex)
    reorderListsMut.mutate(assignSortOrderSlots(reordered))
  }

  // Same shape as ListDetailInner's importMut: createList then populate, then
  // navigate into the new list so imported items are immediately visible.
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

  async function handleExport(list: List) {
    const items = await qc.fetchQuery({
      queryKey: queryKeys.listItems(list.id),
      queryFn: () => fetchListItems(list.id, userId),
    })
    const csv = listItemsToCsv(items, categories)
    downloadCsv(`${list.name.replace(/[^a-z0-9]/gi, '-').toLowerCase() || 'list'}.csv`, csv)
  }

  // Bail out cleanly if the session went null mid-render (logout). Hooks
  // above already ran, so this is safe.
  if (!auth) return null

  // Brand-new user with zero lists → friendly "create your first list" view.
  // ListsEmptyState owns its own import flow, so the cards page's import
  // dialog state is unreachable in this branch.
  if (!listsLoading && lists.length === 0) return <ListsEmptyState />


  return (
    <div className="flex flex-col gap-4">
      {/* Desktop page header. Mobile already has the "Lists" route title in
          the top bar and New/Import actions in the bottom action bar. */}
      <div className="hidden md:flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold text-gray-900">
          Lists
          <span className="ml-2 text-sm font-normal text-gray-500">{lists.length}</span>
        </h1>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {dialog?.type === 'creating' ? (
            <NewListInline
              draft={dialog.draft}
              onChange={(v) => setDialog({ type: 'creating', draft: v })}
              onSubmit={() => {
                const trimmed = dialog.draft.trim()
                if (trimmed) createListMut.mutate(trimmed)
                else setDialog(null)
              }}
              onCancel={() => setDialog(null)}
              saving={createListMut.isPending}
            />
          ) : (
            <>
              {/* Import CSV is a secondary path — demoted to a neutral
                  outline button so it doesn't compete with the primary
                  "New list" affordance. A header kebab would be a better
                  long-term home for this; that move belongs with the
                  upcoming Lists page row refactor (audit phase 2). */}
              <button
                onClick={openImportPicker}
                title="Import a CSV as a new list"
                className="flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                <Upload size={14} /> Import CSV
              </button>
              <PrimaryButton
                onClick={() => setDialog({ type: 'creating', draft: '' })}
                size="sm"
                className="gap-1.5"
              >
                <Plus size={14} /> New list
              </PrimaryButton>
            </>
          )}
        </div>
      </div>

      {/* Hidden input for Import CSV */}
      <input
        ref={importInputRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={handleImportFile}
      />

      {/* Row list. Single bordered container with divide-y between rows —
          a compact list manager rather than a dashboard of cards. The
          row body is owned by ListRow; the sortable wrapper threads the
          drag handle ref/listeners through. */}
      {listsLoading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : (() => {
        const activeParsed = activeId ? parseDnDId(activeId) : null
        const activeList =
          activeParsed?.kind === 'list-card' ? lists.find((l) => l.id === activeParsed.id) : null
        const rowHandlers = (list: List) => ({
          renaming: dialog?.type === 'renaming' && dialog.list.id === list.id,
          renameDraft: dialog?.type === 'renaming' && dialog.list.id === list.id ? dialog.draft : '',
          onRenameDraftChange: (v: string) => setDialog({ type: 'renaming', list, draft: v }),
          onStartRename: () => setDialog({ type: 'renaming', list, draft: list.name }),
          onSubmitRename: () => {
            if (dialog?.type !== 'renaming') return
            const trimmed = dialog.draft.trim()
            if (trimmed && trimmed !== list.name) renameMut.mutate({ id: list.id, name: trimmed })
            setDialog(null)
          },
          onCancelRename: () => setDialog(null),
          onExport: () => handleExport(list),
          onDuplicate: () => duplicateMut.mutate(list),
          onShare: () => setDialog({ type: 'share-list', list }),
          onDelete: () => setDialog({ type: 'confirm-delete', list }),
        })
        return (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
          >
            <SortableContext items={lists.map((l) => makeDnDId('list-card', l.id))} strategy={verticalListSortingStrategy}>
              <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
                <ul className="divide-y divide-gray-100">
                  {lists.map((list) => (
                    <SortableListRow
                      key={list.id}
                      list={list}
                      now={now}
                      reorderPending={reorderListsMut.isPending}
                      {...rowHandlers(list)}
                    />
                  ))}
                </ul>
              </div>
            </SortableContext>
            <DragOverlay>
              {activeList ? (
                // Overlay clone — a static row with a soft shadow so the
                // user can see what they're dragging. Wired to no-op
                // handlers because the overlay is purely visual; the
                // real row underneath still owns interaction.
                <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg">
                  <ul>
                    <ListRow
                      list={activeList}
                      now={now}
                      renaming={false}
                      renameDraft=""
                      onRenameDraftChange={() => {}}
                      onStartRename={() => {}}
                      onSubmitRename={() => {}}
                      onCancelRename={() => {}}
                      onExport={() => {}}
                      onDuplicate={() => {}}
                      onShare={() => {}}
                      onDelete={() => {}}
                    />
                  </ul>
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        )
      })()}

      {/* Share dialog. A plain Modal wrapping PrivacyPanel — the kebab
          menu would fight a nested popover for outside-click dismissal,
          and PrivacyPanel doesn't need anchoring to make sense. The
          dialog reads the live List from the lists cache (rather than
          the snapshot the kebab captured) so the public-link toggle
          re-renders the panel's URL row optimistically after every flip. */}
      {dialog?.type === 'share-list' && (() => {
        const live = lists.find((l) => l.id === dialog.list.id) ?? dialog.list
        return (
          <Modal open onClose={() => setDialog(null)} title="Share list" className="w-full max-w-sm">
            <div className="p-5">
              <div className="mb-3 flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="text-base font-semibold text-gray-900">Share list</h2>
                  <p className="mt-0.5 truncate text-xs text-gray-500">{live.name}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setDialog(null)}
                  aria-label="Close"
                  className="rounded p-1 text-gray-400 hover:text-gray-600"
                >
                  <X size={16} />
                </button>
              </div>
              <PrivacyPanel list={live} />
            </div>
          </Modal>
        )
      })()}

      {/* Delete confirmation */}
      {dialog?.type === 'confirm-delete' && (
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

      {/* Import preview */}
      {dialog?.type === 'import-preview' && (
        <ListImportPreviewDialog
          rows={dialog.rows}
          saving={importMut.isPending}
          onConfirm={() =>
            importMut.mutate({ name: nameFromCsvFilename(dialog.filename), rows: dialog.rows })
          }
          onClose={() => setDialog(null)}
        />
      )}

      {/* Import error */}
      {dialog?.type === 'import-error' && (
        <Modal open onClose={() => setDialog(null)} title="Import error" className="w-full max-w-sm">
          <div className="p-6">
            <h2 className="mb-2 text-base font-semibold text-gray-900">Import error</h2>
            <p className="mb-4 text-sm text-red-600">{dialog.message}</p>
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

      {/* Mobile-only bottom action bar — Lists / Gear / New / Options.
          Import CSV lives behind the Options modal so the bottom bar
          stays focused on "New list" as the primary action. lg:hidden
          inside the component itself, so desktop never renders it. */}
      <MobileListsActionBar
        onNewList={() => setDialog({ type: 'creating', draft: '' })}
        onImportCsv={openImportPicker}
      />
    </div>
  )
}

function NewListInline({
  draft,
  onChange,
  onSubmit,
  onCancel,
  saving,
}: {
  draft: string
  onChange: (v: string) => void
  onSubmit: () => void
  onCancel: () => void
  saving: boolean
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        autoFocus
        type="text"
        placeholder="List name"
        value={draft}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onSubmit()
          if (e.key === 'Escape') onCancel()
        }}
        className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      <PrimaryButton
        onClick={onSubmit}
        disabled={!draft.trim() || saving}
        size="sm"
        className="gap-1.5"
      >
        <Plus size={14} /> Create
      </PrimaryButton>
      <button
        onClick={onCancel}
        aria-label="Cancel"
        className="rounded p-1.5 text-gray-400 hover:text-gray-600"
      >
        <X size={16} />
      </button>
    </div>
  )
}

type ListRowProps = {
  list: List
  // Page-level clock for relative-date display. Drilled down to RowMeta so
  // ListsPage owns one setInterval rather than one per row. M9 fix: pre-
  // fix, formatRelativeDate read Date.now() at render time only, so a row
  // that mounted saying "1 min ago" stayed "1 min ago" forever.
  now: number
  renaming: boolean
  renameDraft: string
  onRenameDraftChange: (v: string) => void
  onStartRename: () => void
  onSubmitRename: () => void
  onCancelRename: () => void
  onExport: () => void
  onDuplicate: () => void
  onShare: () => void
  onDelete: () => void
  // Sortable wrapper threads its dnd-kit ref + transform style + drag-
  // handle button through these. Omitted by the DragOverlay clone (no
  // useSortable in flight there).
  outerRef?: (el: HTMLElement | null) => void
  outerStyle?: React.CSSProperties
  dragHandle?: React.ReactNode
}

// Sortable wrapper for the row list. Calls useSortable, wires the row's
// outer ref + transform style + drag-handle button, and forwards everything
// else to ListRow. Disabled while the row's rename input is open so the
// user can type without accidental drags, and while a previous reorder
// mutation is in flight to prevent the rollback-clobber race when two
// reorders overlap.
function SortableListRow(
  props: Omit<ListRowProps, 'outerRef' | 'outerStyle' | 'dragHandle'> & { reorderPending?: boolean },
) {
  const {
    attributes,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: makeDnDId('list-card', props.list.id),
    disabled: props.renaming || props.reorderPending,
  })

  const sortableStyle: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  }

  const handle = (
    <button
      ref={asButtonRef(setActivatorNodeRef)}
      type="button"
      {...listeners}
      {...attributes}
      tabIndex={-1}
      aria-label="Drag to reorder list"
      // Touch-friendly hit target on mobile (h-10 w-10), tightens on lg+.
      // `touch-none` keeps a drag that starts on the grip from racing the
      // browser's scroll on touch devices; because the grip is a dedicated
      // target (not the whole card) this doesn't cost normal list scrolling.
      // TouchSensor's press-and-hold delay gates accidental drags.
      className="inline-flex h-10 w-10 lg:h-7 lg:w-7 shrink-0 items-center justify-center rounded text-gray-400 cursor-grab touch-none hover:bg-gray-100 hover:text-gray-600 active:cursor-grabbing"
    >
      <GripVertical size={16} />
    </button>
  )

  return (
    <ListRow
      {...props}
      outerRef={setNodeRef}
      outerStyle={sortableStyle}
      dragHandle={handle}
    />
  )
}

function ListRow({
  list,
  now,
  renaming,
  renameDraft,
  onRenameDraftChange,
  onStartRename,
  onSubmitRename,
  onCancelRename,
  onExport,
  onDuplicate,
  onShare,
  onDelete,
  outerRef,
  outerStyle,
  dragHandle,
}: ListRowProps) {
  const { open: menuOpen, openMenu, close, triggerRef, menuRef, menuPos } =
    useAnchoredMenu({ variant: 'right-flush', menuWidth: 176 })
  const renameInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (renaming) renameInputRef.current?.select()
  }, [renaming])

  // Row chrome: a flex strip inside the shared bordered container. No
  // hover-shadow — the container is the visual anchor, and a per-row
  // lift would re-introduce the card feel this refactor is replacing.
  // Hover bg is the same gray-50 every other interactive row in the app
  // uses (gear, list-detail, picker).
  const rowClass =
    'relative flex min-h-11 lg:min-h-8 items-center gap-2 px-3 py-2 hover:bg-gray-50'

  // Renaming swaps the name link for an input. The kebab is hidden during
  // rename to keep the focused control unambiguous; Enter / Escape / blur
  // on the input commits or cancels.
  if (renaming) {
    return (
      <li ref={outerRef as React.Ref<HTMLLIElement>} style={outerStyle} className={rowClass}>
        {dragHandle}
        <input
          ref={renameInputRef}
          autoFocus
          type="text"
          value={renameDraft}
          onChange={(e) => onRenameDraftChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onSubmitRename()
            if (e.key === 'Escape') onCancelRename()
          }}
          onBlur={onSubmitRename}
          className="flex-1 min-w-0 rounded border border-blue-400 px-2 py-1 text-sm font-medium text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </li>
    )
  }

  return (
    <li ref={outerRef as React.Ref<HTMLLIElement>} style={outerStyle} className={rowClass}>
      {dragHandle}

      {/* Name is the primary click target; takes whatever flex room the
          meta and kebab leave behind. truncate caps long names rather
          than wrapping the row. */}
      <Link
        to={`/lists/${list.id}`}
        className="min-w-0 flex-1 truncate text-sm font-medium text-gray-900 focus:outline-none focus:underline"
        aria-label={`Open ${list.name}`}
      >
        {list.name}
      </Link>

      <RowMeta list={list} now={now} />

      {/* Kebab. Hidden during rename above. Live ARIA expanded so screen
          readers track the menu state. */}
      <button
        ref={triggerRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          e.preventDefault()
          if (menuOpen) close()
          else openMenu()
        }}
        aria-label="List options"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        className="inline-flex h-10 w-10 lg:h-7 lg:w-7 shrink-0 items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-600"
      >
        <MoreVertical size={16} />
      </button>

      {menuOpen && menuPos && 'left' in menuPos && createPortal(
        <div
          ref={menuRef}
          role="menu"
          className="fixed z-50 w-44 rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
          style={{ top: menuPos.top, left: menuPos.left }}
        >
          <MenuItem
            icon={<Pencil size={13} />}
            onClick={() => { close(); onStartRename() }}
          >
            Rename
          </MenuItem>
          <MenuItem icon={<Globe size={13} />} onClick={() => { close(); onShare() }}>
            Share…
          </MenuItem>
          <MenuItem icon={<Download size={13} />} onClick={() => { close(); onExport() }}>
            Export CSV
          </MenuItem>
          <MenuItem icon={<CopyPlus size={13} />} onClick={() => { close(); onDuplicate() }}>
            Duplicate
          </MenuItem>
          <div className="my-1 border-t border-gray-100" />
          <MenuItem icon={<Trash2 size={13} />} onClick={() => { close(); onDelete() }} danger>
            Delete
          </MenuItem>
        </div>,
        document.body,
      )}
    </li>
  )
}

function RowMeta({ list, now }: { list: List; now: number }) {
  const updated = formatRelativeDate(list.updated_at, now)
  // Hidden on the smallest viewports so the row stays readable on a
  // narrow phone; comes back at sm+. tabular-nums keeps the column
  // visually steady as the relative time ticks.
  return (
    <span className="hidden sm:inline shrink-0 text-xs tabular-nums text-gray-400">
      Updated {updated}
    </span>
  )
}

// Friendly relative date for the row metadata. Falls back to an absolute
// short date once the value is more than a week old. `now` is supplied by
// the caller's useNow hook so the displayed "X min ago" reticks once a
// minute while the page stays open.
function formatRelativeDate(iso: string, now: number): string {
  const then = new Date(iso).getTime()
  const diffMs = now - then
  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour
  if (diffMs < minute) return 'just now'
  if (diffMs < hour) {
    const m = Math.floor(diffMs / minute)
    return `${m} min${m === 1 ? '' : 's'} ago`
  }
  if (diffMs < day) {
    const h = Math.floor(diffMs / hour)
    return `${h} hour${h === 1 ? '' : 's'} ago`
  }
  if (diffMs < 7 * day) {
    const d = Math.floor(diffMs / day)
    return `${d} day${d === 1 ? '' : 's'} ago`
  }
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function MenuItem({
  icon,
  children,
  onClick,
  danger,
}: {
  icon: React.ReactNode
  children: React.ReactNode
  onClick: () => void
  danger?: boolean
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${
        danger ? 'text-red-600 hover:bg-red-50' : 'text-gray-700 hover:bg-gray-100'
      }`}
    >
      {icon}
      <span className="truncate">{children}</span>
    </button>
  )
}
