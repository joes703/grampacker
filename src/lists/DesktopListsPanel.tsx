import { useState } from 'react'
import { useNavigate } from 'react-router'
import {
  DndContext,
  DragOverlay,
  closestCenter,
} from '@dnd-kit/core'
import {
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { Plus, Upload } from 'lucide-react'
import {
  queryKeys,
  fetchLists,
  reorderLists,
} from '../lib/queries'
import { useCurrentListActions } from './use-current-list-actions'
import { useListImportFlow } from './use-list-import-flow'
import { useReorderable } from '../lib/use-reorderable'
import { makeDnDId } from '../lib/dnd-ids'
import KebabMenu, { type KebabTriggerProps } from '../components/KebabMenu'
import { RowMenuItem } from '../components/RowMenuItem'
import {
  FLAT_TABLE_EYEBROW,
  FLAT_TABLE_SURFACE,
  ROW_CONTROL_TARGET,
} from '../components/flat-table-styles'
import ConfirmDialog from '../components/ConfirmDialog'
import { ListRow, NewListInline, SortableListRow, type ListRowActions } from './ListRow'
import { pickListAfterDelete } from './pick-list-after-delete'
import type { List } from '../lib/types'
import { useDragSensors } from '../lib/use-drag-sensors'

// Desktop-only Lists panel for /lists/:id. Sits above the gear picker in
// the left rail so the user can switch/manage lists without leaving the
// workspace. Mobile keeps /lists as the canonical management surface; this
// panel is JS-gated to lg+ by the caller (ListDetailPage's existing
// `hidden lg:flex` aside).
//
// Reuses existing canonical paths instead of forking:
//   - useCurrentListActions for rename / duplicate / delete
//   - the shared ListRow (variant 'panel') for the sortable row + kebab
//   - useListImportFlow for the whole CSV import surface
//
// What this panel deliberately does NOT carry:
//   - Share. Sharing lives in List options (ListSettingsPanel) inside the
//     open list, not in the Lists switcher.
//   - Mobile rendering. Bottom nav + /lists own that path today.

type Props = {
  // Initial seed for the local lists subscription. Lets the parent's
  // useQuery render the first paint without a flash; once mounted, the
  // panel subscribes to the lists cache itself (see useReorderable below)
  // and that subscription is the source of truth. Required for DnD: the
  // panel's setActiveId state and the lists cache update MUST land in
  // the same React commit so dnd-kit's drop animation measures rects
  // against the new DOM order.
  lists: List[]
  currentListId: string
  // Wraps the panel's outer FLAT_TABLE_SURFACE element. Lets the caller
  // (ListDetailPage's left aside) size/scroll the panel without this
  // file knowing about its sibling. Optional — undefined falls back to
  // an unscoped container.
  className?: string
}

// Local dialog state, mirroring the union-of-variants pattern used elsewhere
// in this codebase. Share is intentionally absent (lives in List options);
// the import preview/error pair lives inside useListImportFlow, which closes
// this union when it opens.
type DialogState =
  | { type: 'creating'; draft: string }
  | { type: 'renaming'; list: List; draft: string }
  | { type: 'confirm-delete'; list: List }

// Hoisted trigger for the header plus menu (KebabMenu `trigger` must be a
// stable component, not an inline closure, or it remounts every render).
function HeaderPlusTrigger({ ref, onClick, open }: Omit<KebabTriggerProps, 'disabled'>) {
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      aria-label="New list or import CSV"
      aria-expanded={open}
      className={`ml-auto ${ROW_CONTROL_TARGET} shrink-0 text-gray-500 hover:bg-gray-200/60 hover:text-gray-800`}
    >
      <Plus size={14} />
    </button>
  )
}

export default function DesktopListsPanel({
  lists: listsSeed,
  currentListId,
  className,
}: Props) {
  const navigate = useNavigate()

  // Shared current-list actions. Same code path used by ListsPage row kebab
  // and the in-list List options popover, so create/rename/duplicate/delete/
  // export semantics stay identical across surfaces. createListMut navigates
  // on success; this panel owns closing the create dialog at the call site.
  const { createListMut, submitCreateList, renameMut, duplicateMut, deleteListMut, exportCsv, exportingListId } =
    useCurrentListActions()

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
    queryFn: fetchLists,
    initialData: listsSeed,
    mutationFn: reorderLists,
    dndKind: 'list-card',
    // The reorder route writes sortOrder only and preserves updatedAt
    // (product rule, pinned in server/routes/lists.test.ts), so
    // reordering does NOT bump the /lists "Updated …" timestamps. Same
    // path as ListsPage.
  })

  const [dialog, setDialog] = useState<DialogState | null>(null)

  // The whole CSV import surface (hidden input, preview, error dialog) in
  // one shared hook; onBeforeOpen keeps this panel's dialog union exclusive.
  const { openImportPicker, importUi } = useListImportFlow({
    onBeforeOpen: () => setDialog(null),
  })

  // Desktop-only panel, so MouseSensor + KeyboardSensor is enough. No
  // TouchSensor: the surrounding aside is `hidden lg:flex`, and bringing it
  // to mobile would mean separate UX work (a card surface is the mobile
  // pattern today). When this panel eventually replaces the mobile cards,
  // the sensor set should match ListsPage's split (MouseSensor 5px +
  // TouchSensor 200ms delay).
  const sensors = useDragSensors({ touch: false })

  // Delete-current-list navigation. When the deleted list is the one
  // currently open, the optimistic delete strips it from the cache and the
  // route falls onto the "List not found" terminal state. Resolve the
  // landing path before issuing the mutation so the user lands somewhere
  // useful instead. pickListAfterDelete is a pure helper with its own
  // unit-test coverage; see pick-list-after-delete.ts for the rule.
  //
  // Navigate on the click, not in a per-call onSuccess: that same "List not
  // found" swap unmounts this panel, and an unmounted mutation observer never
  // runs per-call callbacks, so a success-time navigate never happened. A
  // failed delete rolls back and toasts wherever the user landed.
  function deleteListWithNavigation(target: List) {
    const nextPath = pickListAfterDelete(lists, target.id, currentListId)
    setDialog(null)
    deleteListMut.mutate(target.id)
    if (nextPath) void navigate(nextPath)
  }

  const rowActions = (list: List): ListRowActions => ({
    renaming: dialog?.type === 'renaming' && dialog.list.id === list.id,
    renameDraft: dialog?.type === 'renaming' && dialog.list.id === list.id ? dialog.draft : '',
    onRenameDraftChange: (v) => setDialog({ type: 'renaming', list, draft: v }),
    onStartRename: () => setDialog({ type: 'renaming', list, draft: list.name }),
    onSubmitRename: () => {
      if (dialog?.type !== 'renaming') return
      const trimmed = dialog.draft.trim()
      if (trimmed && trimmed !== list.name) {
        renameMut.mutate({ id: list.id, name: trimmed })
      }
      setDialog(null)
    },
    onCancelRename: () => setDialog(null),
    onDuplicate: () => duplicateMut.mutate(list),
    onExport: () => void exportCsv(list),
    exporting: exportingListId === list.id,
    onDelete: () => setDialog({ type: 'confirm-delete', list }),
  })

  return (
    <div className={`flex flex-col ${FLAT_TABLE_SURFACE} ${className ?? ''}`}>
      {/* Section header — visually matches the gear picker's "Add from gear"
          eyebrow strip so the two surfaces read as siblings. The plus button
          opens a small menu (New list / Import CSV); a bare icon avoids
          competing with the gear search field below. */}
      <div className="relative flex items-center gap-2 border-b border-gray-200 bg-gray-50 px-3 py-2">
        <span className={FLAT_TABLE_EYEBROW}>Lists</span>
        {/* The plus trigger keeps its own chrome (darker hover to read
            against the gray-50 strip), so it goes through `trigger`;
            the menu, anchor and dismiss semantics stay the shared ones. */}
        <KebabMenu
          width={44}
          ariaLabel="New list or import CSV"
          menuLabel="Create or import list"
          trigger={HeaderPlusTrigger}
        >
          {({ close }) => (
            <>
              <RowMenuItem
                icon={<Plus size={13} />}
                onClick={() => {
                  close()
                  setDialog({ type: 'creating', draft: '' })
                }}
              >
                New list
              </RowMenuItem>
              <RowMenuItem
                icon={<Upload size={13} />}
                onClick={() => {
                  close()
                  openImportPicker()
                }}
              >
                Import CSV
              </RowMenuItem>
            </>
          )}
        </KebabMenu>
      </div>

      {importUi}

      {/* Inline "New list" draft input. Rendered as the first row of the
          scroll body so it sits visually adjacent to the rest of the list
          rather than floating in the header strip. Enter submits, Escape
          cancels, blur submits — the shared NewListInline's row variant. */}
      {dialog?.type === 'creating' && (
        <NewListInline
          variant="row"
          draft={dialog.draft}
          saving={createListMut.isPending}
          onChange={(v) => setDialog({ type: 'creating', draft: v })}
          onSubmit={() => {
            const trimmed = dialog.draft.trim()
            if (trimmed) submitCreateList(trimmed, { onSuccess: () => setDialog(null) })
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
                  variant="panel"
                  isCurrent={list.id === currentListId}
                  reorderPending={reorderPending}
                  actions={rowActions(list)}
                />
              ))}
            </ul>
          </SortableContext>
          <DragOverlay dropAnimation={null}>
            {activeList ? (
              <div className={`${FLAT_TABLE_SURFACE} shadow-lg`}>
                <ul>
                  <ListRow
                    list={activeList}
                    variant="panel"
                    isCurrent={activeList.id === currentListId}
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
    </div>
  )
}
