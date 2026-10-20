import { useState } from 'react'
import {
  DndContext,
  DragOverlay,
  closestCenter,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { Plus, Upload, X } from 'lucide-react'
import {
  queryKeys,
  fetchLists,
  reorderLists,
} from '../lib/queries'
import Modal from '../components/Modal'
import { useCurrentListActions } from './use-current-list-actions'
import { useListImportFlow } from './use-list-import-flow'
import { useReorderable } from '../lib/use-reorderable'
import { useIsMobile } from '../lib/use-breakpoint'
import { makeDnDId } from '../lib/dnd-ids'
import type { List } from '../lib/types'
import { useDocumentTitle } from '../lib/use-document-title'
import { useNow } from '../lib/use-now'
import ConfirmDialog from '../components/ConfirmDialog'
import {
  FLAT_TABLE_SURFACE,
  ROW_CONTROL_TARGET,
} from '../components/flat-table-styles'
import {
  LIST_HEADER_ACTION_CLASS,
  ListRow,
  NewListInline,
  SortableListRow,
  type ListRowActions,
} from './ListRow'
import ListsEmptyState from './ListsEmptyState'
import StatusPanel from '../components/StatusPanel'
import MobileListsActionBar from './MobileListsActionBar'
import PrivacyPanel from './PrivacyPanel'

// Single discriminated union for every transient dialog/modal/inline-form on
// this page. Mirrors the pattern in ListDetailPage / GearLibraryPage — `type`
// discriminator, `null` for the closed state. The import preview/error pair
// lives inside useListImportFlow, which closes this union when it opens.
type DialogState =
  | { type: 'creating'; draft: string }
  | { type: 'renaming'; list: List; draft: string }
  | { type: 'confirm-delete'; list: List }
  | { type: 'share-list'; list: List }

export default function ListsPage() {
  useDocumentTitle('Lists')
  // Page-level clock for the per-row "X min ago" displays. One interval
  // for the whole list; rows consume it via a `now` prop.
  const now = useNow(60_000)

  // The reorder state machine — useQuery on ['lists'], reorder mutation,
  // activeId, and handleDragStart/Cancel/End — lives in useReorderable.
  // The page keeps DndContext / SortableContext / DragOverlay JSX
  // ownership and surface-specific sensors. See
  // src/lib/use-reorderable.ts for the same-tick-subscription rationale.
  const {
    items: lists,
    // isPending, NOT isLoading. v5's isLoading is `isPending && isFetching`,
    // so a cold load with the browser offline (fetchStatus 'paused') reports
    // isLoading false with zero rows - and the empty state below would greet
    // an offline user with the brand-new-user onboarding pitch.
    isPending: listsLoading,
    // isLoadingError, NOT isError. In TanStack Query v5 a failed background
    // refetch flips status to 'error' while keeping the cached rows, and list
    // mutations invalidate ['lists'] constantly - so keying the terminal
    // failure screen on bare isError would replace a fully rendered page with
    // "Couldn't load your lists" after any post-mutation network blip.
    isLoadingError: listsError,
    refetch: retryLists,
    activeItem: activeList,
    reorderPending,
    handleDragStart,
    handleDragCancel,
    handleDragEnd,
  } = useReorderable<List>({
    queryKey: queryKeys.lists(),
    queryFn: fetchLists,
    mutationFn: reorderLists,
    dndKind: 'list-card',
  })

  const [dialog, setDialog] = useState<DialogState | null>(null)

  // Below md the desktop header (and its inline NewListInline) is hidden, so
  // the create input renders in a phone-only surface instead. isMobile
  // (max-width 767px) matches the header's md boundary, and gating both sites
  // on it keeps exactly one NewListInline mounted at a time.
  const isMobile = useIsMobile()

  // CSV-import-into-a-new-list: hidden input, preview dialog and error
  // dialog all live in the shared flow hook. onBeforeOpen closes this page's
  // own dialog union so the two state machines cannot both hold a surface.
  const { openImportPicker, importUi } = useListImportFlow({
    onBeforeOpen: () => setDialog(null),
  })

  // Current-list lifecycle actions (create / rename / duplicate / delete /
  // exportCsv). Shared with ListSettingsPanel via useCurrentListActions so
  // both surfaces invoke the same handlers - one canonical code path,
  // multiple entry points (row kebab here, List options popover/modal
  // there). createListMut navigates on success; this page owns closing the
  // create dialog via the call-site onSuccess.
  const { createListMut, submitCreateList, renameMut, duplicateMut, deleteListMut, exportCsv, exportingListId } =
    useCurrentListActions()

  // See ListDetailPage for the rationale. List rows keep their always-
  // visible grip handle as the drag activator on every breakpoint, so on
  // touch a long-press on the grip starts the reorder (MouseSensor handles
  // the desktop mouse drag). Splitting mouse/touch here keeps this page on
  // the same sensor set as the item-row pages.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const submitCreate = () => {
    if (dialog?.type !== 'creating') return
    const trimmed = dialog.draft.trim()
    if (trimmed) submitCreateList(trimmed, { onSuccess: () => setDialog(null) })
    else setDialog(null)
  }

  // Failed lists fetch, checked BEFORE the empty state. useReorderable
  // collapses "failed" into the same empty array as "genuinely has no
  // lists", so without this a dropped connection greeted an existing user
  // with the brand-new-user onboarding pitch, and no way to try again.
  if (listsError) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-xl font-semibold text-gray-900">Lists</h1>
        <StatusPanel
          title="Couldn't load your lists"
          body="Check your connection and try again."
          onRetry={retryLists}
        />
      </div>
    )
  }

  // Brand-new user with zero lists: retain the route heading above the
  // teaching empty state so page identity does not disappear with data.
  if (!listsLoading && lists.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-xl font-semibold text-gray-900">Lists</h1>
        <ListsEmptyState />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold text-gray-900">
          Lists
          <span className="ml-2 text-sm font-normal text-gray-500">{lists.length}</span>
        </h1>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {dialog?.type === 'creating' && !isMobile ? (
            <NewListInline
              variant="header"
              draft={dialog.draft}
              onChange={(v) => setDialog({ type: 'creating', draft: v })}
              onSubmit={submitCreate}
              onCancel={() => setDialog(null)}
              saving={createListMut.isPending}
            />
          ) : (
            // Shown only at >=lg; below lg the MobileListsActionBar's Add
            // slot (New list) and Options modal (Import CSV) own these, so
            // the header buttons would duplicate the bottom bar at
            // 768-1023px. The creating branch above stays md+ so a New list
            // triggered from the bottom bar still shows its inline input on
            // tablet.
            <div className="hidden lg:flex items-center gap-2">
              <button
                type="button"
                onClick={openImportPicker}
                title="Import a CSV as a new list"
                className={LIST_HEADER_ACTION_CLASS}
              >
                <Upload size={14} /> Import CSV
              </button>
              <button
                type="button"
                onClick={() => setDialog({ type: 'creating', draft: '' })}
                className={LIST_HEADER_ACTION_CLASS}
              >
                <Plus size={14} /> New list
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Phone create surface. Below md the desktop header above is hidden, so
          a "New list" tapped from the bottom bar's Add slot would set the
          creating state with no visible input. Render NewListInline here on
          phones. isMobile gates it (and !isMobile gates the header copy) so
          only one input is ever mounted; md:hidden is belt-and-suspenders for
          the resize edge. */}
      {isMobile && dialog?.type === 'creating' && (
        <div className="md:hidden">
          <NewListInline
            variant="header"
            draft={dialog.draft}
            onChange={(v) => setDialog({ type: 'creating', draft: v })}
            onSubmit={submitCreate}
            onCancel={() => setDialog(null)}
            saving={createListMut.isPending}
          />
        </div>
      )}

      {importUi}

      {/* Row list. Single bordered container with divide-y between rows —
          a compact list manager rather than a dashboard of cards. The
          row body is owned by the shared ListRow; the sortable wrapper
          threads the drag handle ref/listeners through. */}
      {listsLoading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : (() => {
        const rowActions = (list: List): ListRowActions => ({
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
          onShare: () => setDialog({ type: 'share-list', list }),
          onExport: () => void exportCsv(list),
          exporting: exportingListId === list.id,
          onDuplicate: () => duplicateMut.mutate(list),
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
              <div className={FLAT_TABLE_SURFACE}>
                <ul className="divide-y divide-gray-100">
                  {lists.map((list) => (
                    <SortableListRow
                      key={list.id}
                      list={list}
                      variant="page"
                      now={now}
                      reorderPending={reorderPending}
                      actions={rowActions(list)}
                    />
                  ))}
                </ul>
              </div>
            </SortableContext>
            <DragOverlay dropAnimation={null}>
              {activeList ? (
                // Overlay clone — a static row with a soft shadow so the
                // user can see what they're dragging. No `actions`: the
                // overlay is purely visual; the real row underneath still
                // owns interaction.
                <div className={`${FLAT_TABLE_SURFACE} shadow-lg`}>
                  <ul>
                    <ListRow list={activeList} variant="page" now={now} />
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
                  className={`${ROW_CONTROL_TARGET} shrink-0 text-gray-500 hover:text-gray-600`}
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

      {/* Mobile-only bottom action bar — Gear / Lists / New / Options.
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
