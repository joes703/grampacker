import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useNavigate } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
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
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ClipboardList, CopyPlus, Download, GripVertical, MoreVertical, Pencil, Plus, Trash2, Upload, X } from 'lucide-react'
import { useAuth } from '../auth/AuthProvider'
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
} from '../lib/queries'
import { assignSortOrderSlots } from '../lib/grouping'
import { asButtonRef } from '../lib/dnd'
import { makeDnDId, parseDnDId } from '../lib/dnd-ids'
import type { List } from '../lib/types'
import { parseListCsv, listItemsToCsv, downloadCsv, nameFromCsvFilename, type ListImportRow } from '../lib/csv'
import { useCsvFileInput } from '../lib/use-csv-file-input'
import { useDocumentTitle } from '../lib/use-document-title'
import { usePortalPopover } from '../lib/use-portal-popover'
import ConfirmDialog from '../components/ConfirmDialog'
import Modal from '../components/Modal'
import ListImportPreviewDialog from './ListImportPreviewDialog'
import ListsEmptyState from './ListsEmptyState'
import PrivacyButton from './PrivacyButton'

// Single discriminated union for every transient dialog/modal/inline-form on
// this page. Mirrors the pattern in ListDetailPage / GearLibraryPage — `type`
// discriminator, `null` for the closed state.
type DialogState =
  | { type: 'creating'; draft: string }
  | { type: 'renaming'; list: List; draft: string }
  | { type: 'confirm-delete'; list: List }
  | { type: 'import-preview'; rows: ListImportRow[]; filename: string }
  | { type: 'import-error'; message: string }

export default function ListsPage() {
  useDocumentTitle('Lists')
  const { session } = useAuth()
  const navigate = useNavigate()
  const qc = useQueryClient()

  // PrivateRoute keeps session non-null in the steady state, but it can flip
  // to null mid-render during sign-out. Resolve a userId once at the top of
  // the component, falling back to '' — every mutation is gated on `session`
  // being present at render time before being invoked, so the empty string
  // is never sent to the server through a mutation. The owner-scoped private
  // queries below pass userId as the user_id filter; an empty string returns
  // empty results rather than the unfiltered union, which is the safer
  // race-window behavior.
  const userId = session?.user.id ?? ''

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
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: queryKeys.lists() })
      setDialog(null)
      navigate(`/lists/${created.id}`)
    },
  })

  const renameMut = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => updateList(id, { name }),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.lists() }),
  })

  const duplicateMut = useMutation({
    mutationFn: (target: List) => duplicateList(target, userId, lists.length),
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: queryKeys.lists() })
      navigate(`/lists/${created.id}`)
    },
  })

  const deleteListMut = useMutation({
    mutationFn: (id: string) => deleteList(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.lists() }),
  })

  const reorderListsMut = useMutation({
    mutationFn: reorderLists,
    ...makeOptimisticReorder<List>(qc, queryKeys.lists()),
  })

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const [activeId, setActiveId] = useState<string | null>(null)

  function handleDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id))
  }

  function handleDragCancel() {
    setActiveId(null)
  }

  // Card-level reorder. The grid is multi-column at sm+/lg+, so we use
  // rectSortingStrategy (calculates target by bounding-rect intersection
  // across wraps) instead of verticalListSortingStrategy. Single case —
  // no category-level concern on this page.
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
  if (!session) return null

  // Brand-new user with zero lists → friendly "create your first list" view.
  // ListsEmptyState owns its own import flow, so the cards page's import
  // dialog state is unreachable in this branch.
  if (!listsLoading && lists.length === 0) return <ListsEmptyState />


  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold text-gray-900">
          Manage Lists
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
              <button
                onClick={openImportPicker}
                title="Import a CSV as a new list"
                className="flex items-center gap-1.5 rounded-lg border border-blue-300 bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-100"
              >
                <Upload size={14} /> Import CSV
              </button>
              <button
                onClick={() => setDialog({ type: 'creating', draft: '' })}
                className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
              >
                <Plus size={14} /> New list
              </button>
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

      {/* Card grid */}
      {listsLoading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : (() => {
        const activeParsed = activeId ? parseDnDId(activeId) : null
        const activeList =
          activeParsed?.kind === 'list-card' ? lists.find((l) => l.id === activeParsed.id) : null
        return (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
          >
            <SortableContext items={lists.map((l) => makeDnDId('list-card', l.id))} strategy={rectSortingStrategy}>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {lists.map((list) => (
                  <SortableListCard
                    key={list.id}
                    list={list}
                    reorderPending={reorderListsMut.isPending}
                    renaming={dialog?.type === 'renaming' && dialog.list.id === list.id}
                    renameDraft={dialog?.type === 'renaming' && dialog.list.id === list.id ? dialog.draft : ''}
                    onRenameDraftChange={(v) => setDialog({ type: 'renaming', list, draft: v })}
                    onStartRename={() => setDialog({ type: 'renaming', list, draft: list.name })}
                    onSubmitRename={() => {
                      if (dialog?.type !== 'renaming') return
                      const trimmed = dialog.draft.trim()
                      if (trimmed && trimmed !== list.name) renameMut.mutate({ id: list.id, name: trimmed })
                      setDialog(null)
                    }}
                    onCancelRename={() => setDialog(null)}
                    onExport={() => handleExport(list)}
                    onDuplicate={() => duplicateMut.mutate(list)}
                    onDelete={() => setDialog({ type: 'confirm-delete', list })}
                  />
                ))}
              </div>
            </SortableContext>
            <DragOverlay>
              {activeList ? (
                <ListCard
                  list={activeList}
                  renaming={false}
                  renameDraft=""
                  onRenameDraftChange={() => {}}
                  onStartRename={() => {}}
                  onSubmitRename={() => {}}
                  onCancelRename={() => {}}
                  onExport={() => {}}
                  onDuplicate={() => {}}
                  onDelete={() => {}}
                />
              ) : null}
            </DragOverlay>
          </DndContext>
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
      <button
        onClick={onSubmit}
        disabled={!draft.trim() || saving}
        className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        <Plus size={14} /> Create
      </button>
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

type ListCardProps = {
  list: List
  renaming: boolean
  renameDraft: string
  onRenameDraftChange: (v: string) => void
  onStartRename: () => void
  onSubmitRename: () => void
  onCancelRename: () => void
  onExport: () => void
  onDuplicate: () => void
  onDelete: () => void
  // Sortable wrapper threads its dnd-kit ref + transform style + drag-
  // handle button through these. Omitted by the DragOverlay clone (no
  // useSortable in flight there).
  outerRef?: (el: HTMLElement | null) => void
  outerStyle?: React.CSSProperties
  dragHandle?: React.ReactNode
}

// Sortable wrapper for the cards grid. Calls useSortable, wires the card
// outer ref + transform style + drag-handle button, and forwards everything
// else to ListCard. Disabled while the card's rename input is open so the
// user can type without accidental drags, and while a previous reorder
// mutation is in flight to prevent the rollback-clobber race when two
// reorders overlap.
function SortableListCard(
  props: Omit<ListCardProps, 'outerRef' | 'outerStyle' | 'dragHandle'> & { reorderPending?: boolean },
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
      className="absolute left-2 top-2 z-20 inline-flex h-7 w-7 items-center justify-center rounded text-gray-400 cursor-grab touch-none hover:bg-gray-100 hover:text-gray-600 active:cursor-grabbing"
    >
      <GripVertical size={16} />
    </button>
  )

  return (
    <ListCard
      {...props}
      outerRef={setNodeRef}
      outerStyle={sortableStyle}
      dragHandle={handle}
    />
  )
}

function ListCard({
  list,
  renaming,
  renameDraft,
  onRenameDraftChange,
  onStartRename,
  onSubmitRename,
  onCancelRename,
  onExport,
  onDuplicate,
  onDelete,
  outerRef,
  outerStyle,
  dragHandle,
}: ListCardProps) {
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const renameInputRef = useRef<HTMLInputElement>(null)
  const menuOpen = menuPos !== null

  usePortalPopover({
    isOpen: menuOpen,
    onClose: () => setMenuPos(null),
    triggerRef,
    contentRef: menuRef,
  })

  useEffect(() => {
    if (renaming) renameInputRef.current?.select()
  }, [renaming])

  function openMenu() {
    if (!triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    const menuWidth = 176 // matches w-44
    setMenuPos({
      top: rect.bottom + 4,
      left: Math.max(8, rect.right - menuWidth),
    })
  }

  // Card chrome: same border/radius/bg the gear page uses for category sections.
  // Hover lift kept subtle so the grid doesn't feel busy.
  const cardClass =
    'relative flex flex-col rounded-xl border border-gray-200 bg-white p-4 transition-shadow hover:shadow-md'

  // Renaming swaps the title for an input and disables card navigation. Keeps
  // the kebab visible so the user can cancel by reopening the menu, but the
  // common path is Enter / Escape / blur on the input itself. The drag handle
  // is also rendered (the SortableListCard wrapper passes `disabled: renaming`
  // to useSortable, so the handle is inert during rename — keeps layout stable).
  if (renaming) {
    return (
      <div ref={outerRef} style={outerStyle} className={cardClass}>
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
          className="ml-8 w-[calc(100%-2rem)] rounded border border-blue-400 px-2 py-1 text-base font-semibold text-gray-900 focus:outline-none"
        />
        <CardMeta list={list} />
      </div>
    )
  }

  return (
    <div ref={outerRef} style={outerStyle} className={cardClass}>
      {dragHandle}
      {/* Whole-card link covers the card area. The drag handle and kebab
          buttons above sit in a higher stacking context so their clicks
          aren't intercepted. PointerSensor activation distance of 5px keeps
          accidental click-vs-drag misreads off the table. */}
      <Link
        to={`/lists/${list.id}`}
        className="absolute inset-0 z-0 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
        aria-label={`Open ${list.name}`}
      />

      <div className="relative z-10 pointer-events-none">
        <h3 className="truncate px-8 text-base font-semibold text-gray-900">{list.name}</h3>
        <CardMeta list={list} />
      </div>

      {/* Workflow actions: Pack launches into pack mode via the URL state
          on /lists/:id; Share reuses the in-list PrivacyButton (its popover
          is anchored to its own trigger, so dropping it into the card just
          works). The row sits at z-10 with pointer-events-auto, above the
          card's full-area Link at z-0 — clicks on the buttons hit them
          directly via z-order, no propagation interception needed. */}
      <div className="relative z-10 mt-3 flex items-center justify-end gap-2 pointer-events-auto">
        <Link
          to={`/lists/${list.id}?mode=pack`}
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-50"
        >
          <ClipboardList size={14} />
          <span className="hidden sm:inline">Pack</span>
        </Link>
        <PrivacyButton list={list} />
      </div>

      {/* Kebab — pointer-events-auto so it overrides the parent's
          pointer-events-none, giving it precedence over the absolute Link. */}
      <button
        ref={triggerRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          e.preventDefault()
          if (menuOpen) setMenuPos(null)
          else openMenu()
        }}
        aria-label="List options"
        className="absolute right-2 top-2 z-20 inline-flex h-7 w-7 items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-600"
      >
        <MoreVertical size={16} />
      </button>

      {menuOpen && menuPos && createPortal(
        <div
          ref={menuRef}
          className="fixed z-50 w-44 rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
          style={{ top: menuPos.top, left: menuPos.left }}
        >
          <MenuItem
            icon={<Pencil size={13} />}
            onClick={() => { setMenuPos(null); onStartRename() }}
          >
            Rename
          </MenuItem>
          <MenuItem icon={<Download size={13} />} onClick={() => { setMenuPos(null); onExport() }}>
            Export CSV
          </MenuItem>
          <MenuItem icon={<CopyPlus size={13} />} onClick={() => { setMenuPos(null); onDuplicate() }}>
            Duplicate
          </MenuItem>
          <div className="my-1 border-t border-gray-100" />
          <MenuItem icon={<Trash2 size={13} />} onClick={() => { setMenuPos(null); onDelete() }} danger>
            Delete
          </MenuItem>
        </div>,
        document.body,
      )}
    </div>
  )
}

function CardMeta({ list }: { list: List }) {
  const updated = formatRelativeDate(list.updated_at)
  return (
    <div className="mt-2 space-y-1 text-sm text-gray-500">
      {list.description && (
        <p className="line-clamp-2 text-gray-600">{list.description}</p>
      )}
      <p className="text-xs text-gray-400">Updated {updated}</p>
    </div>
  )
}

// Friendly relative date for the card metadata. Falls back to an absolute
// short date once the value is more than a week old.
function formatRelativeDate(iso: string): string {
  const then = new Date(iso).getTime()
  const now = Date.now()
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
