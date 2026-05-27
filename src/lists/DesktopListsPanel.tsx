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
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CopyPlus, Download, MoreVertical, Pencil, Plus, Trash2, Upload } from 'lucide-react'
import {
  queryKeys,
  fetchGearItems,
  fetchCategories,
  fetchLists,
  createList,
  nextListSortOrder,
  reorderLists,
  importCsvRowsToList,
  makeOptimisticInsert,
} from '../lib/queries'
import { useCurrentListActions } from './use-current-list-actions'
import { useReorderable } from '../lib/use-reorderable'
import { makeDnDId } from '../lib/dnd-ids'
import { useListCardSortable, LIST_RENAME_INPUT_CLASS } from './list-card-sortable'
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
  POPOVER_SURFACE,
  ROW_CONTROL_TARGET,
} from '../components/flat-table-styles'
import ConfirmDialog from '../components/ConfirmDialog'
import Modal from '../components/Modal'
import ListImportPreviewDialog from './ListImportPreviewDialog'
import { pickListAfterDelete } from './pick-list-after-delete'
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
  // Initial seed for the local lists subscription. Lets the parent's
  // useQuery render the first paint without a flash; once mounted, the
  // panel subscribes to the lists cache itself (see useQuery below) and
  // that subscription is the source of truth. Required for DnD: the
  // panel's setActiveId state and the lists cache update MUST land in
  // the same React commit so dnd-kit's drop animation measures rects
  // against the new DOM order. See the useQuery comment below for the
  // race-class rationale.
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

export default function DesktopListsPanel({
  userId,
  lists: listsSeed,
  currentListId,
  className,
}: Props) {
  const navigate = useNavigate()
  const qc = useQueryClient()

  // Shared current-list actions. Same code path used by ListsPage card kebab
  // and the in-list List options popover, so rename/duplicate/export/delete
  // semantics stay identical across surfaces.
  const { renameMut, duplicateMut, deleteListMut, exportCsv } = useCurrentListActions(userId)

  // The reorder state machine — useQuery on ['lists'], useMutation on
  // reorderLists with makeOptimisticReorder, activeId, and the
  // handleDragStart/Cancel/End shape — lives in useReorderable. The hook
  // owning the lists subscription is the structural fix for the
  // cross-component snap-back race (commit b8624ec); see
  // src/lib/use-reorderable.ts for the full rationale.
  const {
    items: lists,
    activeItem: activeList,
    reorderPending,
    handleDragStart,
    handleDragCancel,
    handleDragEnd,
  } = useReorderable<List>({
    queryKey: queryKeys.lists(),
    queryFn: () => fetchLists(userId),
    initialData: listsSeed,
    mutationFn: reorderLists,
    dndKind: 'list-card',
    // bulk_update_sort_order preserves updated_at on sort_order-only
    // writes (migration 20260524140830), so reordering does NOT bump
    // the /lists "Updated …" timestamps. Same path as ListsPage.
  })

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
    mutationFn: (name: string) => createList(userId, name, nextListSortOrder(lists)),
    ...makeOptimisticInsert<List, string>({
      qc,
      queryKey: queryKeys.lists(),
      optimistic: (name) => optimisticListPlaceholder({ name, userId, sortOrder: nextListSortOrder(lists) }),
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
      const newList = await createList(userId, name, nextListSortOrder(lists))
      await importCsvRowsToList(newList.id, userId, rows, gearItems, categories)
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

  // Delete-current-list navigation. When the deleted list is the one
  // currently open, the optimistic delete strips it from the cache and the
  // route falls onto the "List not found" terminal state. Resolve the
  // landing path before issuing the mutation so the user lands somewhere
  // useful instead. pickListAfterDelete is a pure helper with its own
  // unit-test coverage; see pick-list-after-delete.ts for the rule.
  function deleteListWithNavigation(target: List) {
    const nextPath = pickListAfterDelete(lists, target.id, currentListId)
    setDialog(null)
    deleteListMut.mutate(target.id, {
      onSuccess: () => {
        if (nextPath) navigate(nextPath)
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

  return (
    <div className={`flex flex-col ${FLAT_TABLE_SURFACE} ${className ?? ''}`}>
      {/* Section header — visually matches the gear picker's "Add from gear"
          eyebrow strip so the two surfaces read as siblings. The plus button
          opens a small menu (New list / Import CSV); a bare icon avoids
          competing with the gear search field below. */}
      <div className="relative flex items-center gap-2 border-b border-gray-200 bg-gray-50 px-3 py-2">
        <span className={FLAT_TABLE_EYEBROW}>Lists</span>
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
          className={`ml-auto ${ROW_CONTROL_TARGET} shrink-0 text-gray-500 hover:bg-gray-200/60 hover:text-gray-800`}
        >
          <Plus size={14} />
        </button>
        {headerMenuOpen && headerMenuPos && 'left' in headerMenuPos &&
          createPortal(
            <div
              ref={headerMenuRef}
              role="menu"
              className={`fixed z-50 w-44 py-1 ${POPOVER_SURFACE}`}
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
                  reorderPending={reorderPending}
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
          <DragOverlay dropAnimation={null}>
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

// Sortable wrapper for the panel row. Wires the outer ref + transform
// style + drag-handle button via the shared useListCardSortable hook
// (see list-card-sortable.tsx) and forwards everything else to
// ListPanelRow. Disabled while renaming or while a prior reorder is in
// flight (the latter avoids the rollback-clobber race that two
// overlapping reorders can hit). The hook places the grip inside the row
// (not in the gutter outside the clipped FLAT_TABLE_SURFACE) so it
// remains visible. gripIconSize defaults to 14 for this denser surface;
// the ListsPage card-page row passes 16 explicitly.
function SortableListRow(
  props: Omit<ListPanelRowProps, 'outerRef' | 'outerStyle' | 'dragHandle'> & { reorderPending?: boolean },
) {
  const { outerRef, outerStyle, dragHandle } = useListCardSortable({
    listId: props.list.id,
    disabled: props.renaming || props.reorderPending,
  })
  return (
    <ListPanelRow
      {...props}
      outerRef={outerRef}
      outerStyle={outerStyle}
      dragHandle={dragHandle}
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
          className={`min-w-0 flex-1 ${LIST_RENAME_INPUT_CLASS}`}
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
            className={`fixed z-50 w-44 py-1 ${POPOVER_SURFACE}`}
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
