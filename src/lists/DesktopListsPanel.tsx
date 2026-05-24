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
import { CopyPlus, Download, GripVertical, MoreVertical, Pencil, Plus, Trash2, Upload } from 'lucide-react'
import {
  queryKeys,
  fetchGearItems,
  fetchCategories,
  createList,
  reorderLists,
  importCsvRowsToList,
  makeOptimisticReorder,
  makeOptimisticInsert,
} from '../lib/queries'
import { useCurrentListActions } from './use-current-list-actions'
import { assignSortOrderSlots } from '../lib/grouping'
import { asButtonRef } from '../lib/dnd'
import { makeDnDId, parseDnDId } from '../lib/dnd-ids'
import { parseListCsv, nameFromCsvFilename, type ListImportRow } from '../lib/csv'
import { useCsvFileInput } from '../lib/use-csv-file-input'
import { optimisticListPlaceholder } from '../lib/optimistic-list-placeholder'
import { useAnchoredMenu } from '../lib/use-anchored-menu'
import { RowMenuItem, RowMenuSeparator } from '../components/RowMenuItem'
import {
  FLAT_TABLE_BODY_TEXT,
  FLAT_TABLE_EYEBROW,
  FLAT_TABLE_ROW,
  FLAT_TABLE_SURFACE,
  ROW_CONTROL_TARGET,
} from '../components/flat-table-styles'
import ConfirmDialog from '../components/ConfirmDialog'
import Modal from '../components/Modal'
import ListImportPreviewDialog from './ListImportPreviewDialog'
import type { List } from '../lib/types'

// Desktop-only Lists panel for /lists/:id. Sits above the gear picker in
// the left rail so the user can switch/manage lists without leaving the
// workspace. Mobile keeps /lists as the canonical management surface; this
// panel is JS-gated to lg+ by the caller (ListDetailPage's existing
// `hidden lg:flex` aside).
//
// Reuses existing canonical paths instead of forking:
//   - useCurrentListActions for rename / duplicate / export / delete
//   - reorderLists + assignSortOrderSlots for DnD
//   - parseListCsv + useCsvFileInput + ListImportPreviewDialog for import
//   - RowMenuItem / RowMenuSeparator for kebab content
//   - FLAT_TABLE_SURFACE / FLAT_TABLE_ROW / ROW_CONTROL_TARGET for the
//     visual grammar so this reads like the gear picker below it
//
// What this panel deliberately does NOT carry:
//   - Share. Sharing lives in List options (ListSettingsPanel) inside the
//     open list, not in the Lists switcher.
//   - The Duplicate is row-specific only (no header bulk Duplicate).
//   - Mobile rendering. Bottom nav + /lists own that path today.

type Props = {
  userId: string
  lists: List[]
  currentListId: string
  // Wraps the panel's outer FLAT_TABLE_SURFACE element. Lets the caller
  // (ListDetailPage's left aside) size/scroll the panel without this
  // file knowing about its sibling. Optional — undefined falls back to
  // an unscoped container.
  className?: string
}

// Local dialog state, mirroring the union-of-variants pattern used elsewhere
// in this codebase. Share is intentionally absent (lives in List options).
type DialogState =
  | { type: 'creating'; draft: string }
  | { type: 'renaming'; list: List; draft: string }
  | { type: 'confirm-delete'; list: List }
  | { type: 'import-preview'; rows: ListImportRow[]; filename: string }
  | { type: 'import-error'; message: string }

export default function DesktopListsPanel({ userId, lists, currentListId, className }: Props) {
  const navigate = useNavigate()
  const qc = useQueryClient()

  // Shared current-list actions. Same code path used by ListsPage card kebab
  // and the in-list List options popover, so rename/duplicate/export/delete
  // semantics stay identical across surfaces.
  const { renameMut, duplicateMut, deleteListMut, exportCsv } = useCurrentListActions(userId)

  // gearItems / categories are needed for CSV import (importCsvRowsToList
  // resolves names against existing inventory). They're already cached by
  // ListDetailPage's parent queries, so these reads are effectively
  // free reference-fetches.
  const { data: gearItems = [] } = useQuery({
    queryKey: queryKeys.gearItems(),
    queryFn: () => fetchGearItems(userId),
  })
  const { data: categories = [] } = useQuery({
    queryKey: queryKeys.categories(),
    queryFn: () => fetchCategories(userId),
  })

  const [dialog, setDialog] = useState<DialogState | null>(null)

  // Hidden file input + parser wiring for "Import CSV". The same useCsvFileInput
  // hook ListsPage consumes — re-use, not re-implement.
  const {
    inputRef: importInputRef,
    onChange: handleImportFile,
    openPicker: openImportPicker,
  } = useCsvFileInput<ListImportRow>(parseListCsv, {
    onParsed: (rows, filename) => setDialog({ type: 'import-preview', rows, filename }),
    onError: (message) => setDialog({ type: 'import-error', message }),
  })

  // New-list flow: optimistic insert against ['lists'] then navigate. Mirrors
  // ListsPage.createListMut so the user-visible behavior is the same whether
  // the new list is started from /lists or from this panel.
  const createListMut = useMutation({
    mutationFn: (name: string) => createList(userId, name, lists.length),
    ...makeOptimisticInsert<List, string>({
      qc,
      queryKey: queryKeys.lists(),
      optimistic: (name) => optimisticListPlaceholder({ name, userId, sortOrder: lists.length }),
    }),
    onSuccess: (created) => {
      setDialog(null)
      navigate(`/lists/${created.id}`)
    },
  })

  // CSV-import flow: createList then populate, then navigate into the new
  // list. Same shape ListsPage uses so a CSV imported here behaves identically.
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

  const reorderListsMut = useMutation({
    mutationFn: reorderLists,
    ...makeOptimisticReorder<List>(qc, queryKeys.lists()),
  })

  // Desktop-only panel, so MouseSensor + KeyboardSensor is enough. No
  // TouchSensor: the surrounding aside is `hidden lg:flex`, and bringing it
  // to mobile would mean separate UX work (a card surface is the mobile
  // pattern today). When this panel eventually replaces the mobile cards,
  // the sensor set should match ListsPage's split (MouseSensor 5px +
  // TouchSensor 200ms delay).
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const [activeId, setActiveId] = useState<string | null>(null)

  function handleDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id))
  }
  function handleDragCancel() {
    setActiveId(null)
  }
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
    // bulk_update_sort_order now preserves updated_at on sort_order-only
    // writes (migration 20260524140830), so reordering does NOT bump the
    // /lists "Updated …" timestamps. See ListsPage for the same path.
    reorderListsMut.mutate(assignSortOrderSlots(reordered))
  }

  // Delete-current-list navigation. When the deleted list is the one
  // currently open, the optimistic delete strips it from the cache and the
  // route falls onto the "List not found" terminal state. Pick a sensible
  // landing spot before issuing the mutation so the user lands somewhere
  // useful instead.
  //
  // Resolution order:
  //   1. next visible list in current sort order
  //   2. previous visible list in current sort order
  //   3. /lists (the no-lists fallback)
  //
  // TODO: when desktop list management fully replaces the card page, the
  // no-lists desktop fallback should become an in-workspace empty state
  // (right-rail panel) instead of bouncing to /lists. The card page is
  // the only surface that currently renders the "create your first list"
  // empty UI, so /lists is the right destination until that lands.
  function deleteListWithNavigation(target: List) {
    const isCurrent = target.id === currentListId
    let nextPath = '/lists'
    if (isCurrent) {
      const idx = lists.findIndex((l) => l.id === target.id)
      const next = idx >= 0 ? lists[idx + 1] : undefined
      const prev = idx > 0 ? lists[idx - 1] : undefined
      const successor = next ?? prev
      if (successor) nextPath = `/lists/${successor.id}`
    }
    setDialog(null)
    deleteListMut.mutate(target.id, {
      onSuccess: () => {
        if (isCurrent) navigate(nextPath)
      },
    })
  }

  // Header plus-button menu: New list / Import CSV. Anchored to the plus
  // button via useAnchoredMenu (same hook every row kebab uses), so dismiss
  // semantics (outside mousedown, scroll, resize, escape) match every other
  // popover in the app. Destructured because the lint plugin
  // (react-hooks/refs) reads any nested `.menuPos` access as a ref access
  // during render; pulling the values out at the top of the component sides
  // with the row pattern already in use across the codebase.
  const {
    open: headerMenuOpen,
    openMenu: openHeaderMenu,
    close: closeHeaderMenu,
    triggerRef: headerMenuTriggerRef,
    menuRef: headerMenuRef,
    menuPos: headerMenuPos,
  } = useAnchoredMenu({ variant: 'right-flush', menuWidth: 176 })

  const activeParsed = activeId ? parseDnDId(activeId) : null
  const activeList =
    activeParsed?.kind === 'list-card' ? lists.find((l) => l.id === activeParsed.id) : null

  return (
    <div className={`flex flex-col ${FLAT_TABLE_SURFACE} ${className ?? ''}`}>
      {/* Section header — visually matches the gear picker's "Add from gear"
          eyebrow strip so the two surfaces read as siblings. The plus button
          opens a small menu (New list / Import CSV); a bare icon avoids
          competing with the gear search field below. */}
      <div className="relative flex items-center gap-2 border-b border-gray-200 bg-gray-50 px-3 py-2">
        <span className={FLAT_TABLE_EYEBROW}>Lists</span>
        <span className="ml-auto text-xs font-normal tabular-nums text-gray-400">{lists.length}</span>
        <button
          ref={headerMenuTriggerRef}
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            e.preventDefault()
            if (headerMenuOpen) closeHeaderMenu()
            else openHeaderMenu()
          }}
          aria-label="New list or import CSV"
          aria-haspopup="menu"
          aria-expanded={headerMenuOpen}
          className={`${ROW_CONTROL_TARGET} shrink-0 text-gray-500 hover:bg-gray-200/60 hover:text-gray-800`}
        >
          <Plus size={14} />
        </button>
        {headerMenuOpen && headerMenuPos && 'left' in headerMenuPos &&
          createPortal(
            <div
              ref={headerMenuRef}
              role="menu"
              className="fixed z-50 w-44 rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
              style={{ top: headerMenuPos.top, left: headerMenuPos.left }}
            >
              <RowMenuItem
                icon={<Plus size={13} />}
                onClick={() => {
                  closeHeaderMenu()
                  setDialog({ type: 'creating', draft: '' })
                }}
              >
                New list
              </RowMenuItem>
              <RowMenuItem
                icon={<Upload size={13} />}
                onClick={() => {
                  closeHeaderMenu()
                  openImportPicker()
                }}
              >
                Import CSV
              </RowMenuItem>
            </div>,
            document.body,
          )}
      </div>

      {/* Hidden CSV input. The file picker fires from openImportPicker(),
          dispatched by the header menu. Re-using the existing useCsvFileInput
          hook means no separate parser/abort/error path. */}
      <input
        ref={importInputRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={handleImportFile}
      />

      {/* Inline "New list" draft input. Rendered as the first row of the
          scroll body so it sits visually adjacent to the rest of the list
          rather than floating in the header strip. Enter submits, Escape
          cancels — same shape ListsPage uses inline next to its header. */}
      {dialog?.type === 'creating' && (
        <NewListInlineRow
          draft={dialog.draft}
          saving={createListMut.isPending}
          onChange={(v) => setDialog({ type: 'creating', draft: v })}
          onSubmit={() => {
            const trimmed = dialog.draft.trim()
            if (trimmed) createListMut.mutate(trimmed)
            else setDialog(null)
          }}
          onCancel={() => setDialog(null)}
        />
      )}

      {/* Row list. min-h-0 + overflow-y-auto allows the caller to bound the
          panel's height (the aside is a sticky fixed-height container, so
          the rows scroll if the user has many lists) without a manual
          max-height token here. */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
        >
          <SortableContext
            items={lists.map((l) => makeDnDId('list-card', l.id))}
            strategy={verticalListSortingStrategy}
          >
            <ul>
              {lists.map((list) => (
                <SortableListRow
                  key={list.id}
                  list={list}
                  isCurrent={list.id === currentListId}
                  renaming={dialog?.type === 'renaming' && dialog.list.id === list.id}
                  renameDraft={
                    dialog?.type === 'renaming' && dialog.list.id === list.id ? dialog.draft : ''
                  }
                  reorderPending={reorderListsMut.isPending}
                  onRenameDraftChange={(v) => setDialog({ type: 'renaming', list, draft: v })}
                  onStartRename={() => setDialog({ type: 'renaming', list, draft: list.name })}
                  onSubmitRename={() => {
                    if (dialog?.type !== 'renaming') return
                    const trimmed = dialog.draft.trim()
                    if (trimmed && trimmed !== list.name) {
                      renameMut.mutate({ id: list.id, name: trimmed })
                    }
                    setDialog(null)
                  }}
                  onCancelRename={() => setDialog(null)}
                  onExport={() => exportCsv(list)}
                  onDuplicate={() => duplicateMut.mutate(list)}
                  onDelete={() => setDialog({ type: 'confirm-delete', list })}
                />
              ))}
            </ul>
          </SortableContext>
          <DragOverlay>
            {activeList ? (
              <div className={`${FLAT_TABLE_SURFACE} shadow-lg`}>
                <ul>
                  <ListPanelRow
                    list={activeList}
                    isCurrent={activeList.id === currentListId}
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
                </ul>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      </div>

      {/* Delete confirmation. Resolves the navigation target before calling
          deleteListMut so deleting the open list lands on a sibling instead
          of "List not found". */}
      {dialog?.type === 'confirm-delete' && (
        <ConfirmDialog
          title="Delete list"
          message={`This will permanently delete "${dialog.list.name}" and all of its items. This cannot be undone.`}
          confirmLabel="Delete list"
          dangerous
          onCancel={() => setDialog(null)}
          onConfirm={() => deleteListWithNavigation(dialog.list)}
        />
      )}

      {/* Import preview — reuses the existing ListImportPreviewDialog so
          the desktop panel and the /lists card surface render the same
          confirm UI for the same parsed CSV. */}
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

      {/* Import error. Same plain modal shape ListsPage uses; intentionally
          minimal because the CSV parser already produces user-facing copy. */}
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

// Inline first-row draft for "New list". Lives inside the scrollable body so
// it doesn't bulk up the header strip when a user opens the menu.
function NewListInlineRow({
  draft,
  saving,
  onChange,
  onSubmit,
  onCancel,
}: {
  draft: string
  saving: boolean
  onChange: (v: string) => void
  onSubmit: () => void
  onCancel: () => void
}) {
  return (
    <div className={`${FLAT_TABLE_ROW} w-full gap-2 px-3 py-0 bg-blue-50/40`}>
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
        onBlur={onSubmit}
        disabled={saving}
        className="min-w-0 flex-1 rounded border border-blue-400 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
    </div>
  )
}

type ListPanelRowProps = {
  list: List
  isCurrent: boolean
  renaming: boolean
  renameDraft: string
  onRenameDraftChange: (v: string) => void
  onStartRename: () => void
  onSubmitRename: () => void
  onCancelRename: () => void
  onExport: () => void
  onDuplicate: () => void
  onDelete: () => void
  outerRef?: (el: HTMLElement | null) => void
  outerStyle?: React.CSSProperties
  dragHandle?: React.ReactNode
}

// useSortable wrapper. Disabled while renaming or while a prior reorder is
// in flight (the latter avoids the rollback-clobber race that two
// overlapping reorders can hit).
function SortableListRow(
  props: Omit<ListPanelRowProps, 'outerRef' | 'outerStyle' | 'dragHandle'> & { reorderPending?: boolean },
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

  // Drag handle sits inside the row (not in the gutter outside the clipped
  // FLAT_TABLE_SURFACE) so it remains visible — a previous out-of-surface
  // gutter handle got clipped by the surface's overflow-hidden.
  const handle = (
    <button
      ref={asButtonRef(setActivatorNodeRef)}
      type="button"
      {...listeners}
      {...attributes}
      tabIndex={-1}
      aria-label="Drag to reorder list"
      className={`${ROW_CONTROL_TARGET} shrink-0 text-gray-400 cursor-grab touch-none hover:bg-gray-100 hover:text-gray-600 active:cursor-grabbing`}
    >
      <GripVertical size={14} />
    </button>
  )

  return (
    <ListPanelRow
      {...props}
      outerRef={setNodeRef}
      outerStyle={sortableStyle}
      dragHandle={handle}
    />
  )
}

// Single row. Uses FLAT_TABLE_ROW so the row tracks the shared density layer.
// Current-list highlight: a soft blue tint + medium-weight name so the user
// can see at a glance which list this workspace is showing.
function ListPanelRow({
  list,
  isCurrent,
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
}: ListPanelRowProps) {
  const { open: menuOpen, openMenu, close, triggerRef, menuRef, menuPos } =
    useAnchoredMenu({ variant: 'right-flush', menuWidth: 176 })
  const renameInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (renaming) renameInputRef.current?.select()
  }, [renaming])

  // Highlight state: soft blue rest tint + medium-weight name so the user
  // can locate the open list immediately on every render. Hover stays on
  // gray-100 across both states so click feedback is consistent.
  const activeBg = isCurrent ? 'bg-blue-50' : ''
  const rowClass = `${FLAT_TABLE_ROW} w-full gap-2 px-3 py-0 ${activeBg} hover:bg-gray-100`

  if (renaming) {
    return (
      <li
        ref={outerRef as React.Ref<HTMLLIElement>}
        style={outerStyle}
        className={rowClass}
      >
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
          className="min-w-0 flex-1 rounded border border-blue-400 px-2 py-1 text-sm font-medium text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </li>
    )
  }

  return (
    <li
      ref={outerRef as React.Ref<HTMLLIElement>}
      style={outerStyle}
      className={rowClass}
    >
      {dragHandle}

      {/* Name is the primary click target. Link instead of button so middle-
          click / cmd-click open in a new tab — same behavior as the gear
          picker's row buttons would NOT give (those toggle membership). */}
      <Link
        to={`/lists/${list.id}`}
        className={`min-w-0 flex-1 truncate ${FLAT_TABLE_BODY_TEXT} ${
          isCurrent ? 'font-medium text-gray-900' : 'font-normal text-gray-700'
        } focus:outline-none focus:underline`}
        aria-label={`Open ${list.name}`}
        aria-current={isCurrent ? 'page' : undefined}
      >
        {list.name}
      </Link>

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
        className={`${ROW_CONTROL_TARGET} shrink-0 text-gray-400 hover:bg-gray-100 hover:text-gray-600`}
      >
        <MoreVertical size={14} />
      </button>

      {menuOpen && menuPos && 'left' in menuPos &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            className="fixed z-50 w-44 rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
            style={{ top: menuPos.top, left: menuPos.left }}
          >
            <RowMenuItem
              icon={<Pencil size={13} />}
              onClick={() => {
                close()
                onStartRename()
              }}
            >
              Rename
            </RowMenuItem>
            <RowMenuItem
              icon={<CopyPlus size={13} />}
              onClick={() => {
                close()
                onDuplicate()
              }}
            >
              Duplicate
            </RowMenuItem>
            <RowMenuItem
              icon={<Download size={13} />}
              onClick={() => {
                close()
                onExport()
              }}
            >
              Export CSV
            </RowMenuItem>
            <RowMenuSeparator />
            <RowMenuItem
              icon={<Trash2 size={13} />}
              onClick={() => {
                close()
                onDelete()
              }}
              tone="danger"
            >
              Delete
            </RowMenuItem>
          </div>,
          document.body,
        )}
    </li>
  )
}
