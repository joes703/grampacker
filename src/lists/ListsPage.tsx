import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router'
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
import { CopyPlus, Download, Globe, MoreVertical, Pencil, Plus, Trash2, Upload, X } from 'lucide-react'
import {
  queryKeys,
  fetchLists,
  reorderLists,
} from '../lib/queries'
import { parseListCsv, nameFromCsvFilename, type ListCsvRow } from '../lib/csv'
import { useCsvFileInput } from '../lib/use-csv-file-input'
import { useListImportMutation } from './use-list-import-mutation'
import ListImportPreviewDialog from './ListImportPreviewDialog'
import Modal from '../components/Modal'
import { useCurrentListActions } from './use-current-list-actions'
import { useReorderable } from '../lib/use-reorderable'
import { useIsMobile } from '../lib/use-breakpoint'
import { makeDnDId } from '../lib/dnd-ids'
import { useListCardSortable, LIST_RENAME_INPUT_CLASS } from './list-card-sortable'
import type { List } from '../lib/types'
import DraftBadge from '../components/DraftBadge'
import { useDocumentTitle } from '../lib/use-document-title'
import { useCommitOnce } from '../lib/use-commit-once'
import { useNow } from '../lib/use-now'
import { useAnchoredMenu } from '../lib/use-anchored-menu'
import ConfirmDialog from '../components/ConfirmDialog'
import {
  DESKTOP_ROW_HEIGHT,
  FLAT_TABLE_SURFACE,
  MOBILE_ROW_HEIGHT,
  POPOVER_SURFACE,
  ROW_CONTROL_TARGET,
} from '../components/flat-table-styles'
import { RowMenuItem, RowMenuSeparator } from '../components/RowMenuItem'
import ListsEmptyState from './ListsEmptyState'
import StatusPanel from '../components/StatusPanel'
import MobileListsActionBar from './MobileListsActionBar'
import PrivacyPanel from './PrivacyPanel'

// Single discriminated union for every transient dialog/modal/inline-form on
// this page. Mirrors the pattern in ListDetailPage / GearLibraryPage — `type`
// discriminator, `null` for the closed state.
type DialogState =
  | { type: 'creating'; draft: string }
  | { type: 'renaming'; list: List; draft: string }
  | { type: 'confirm-delete'; list: List }
  | { type: 'share-list'; list: List }
  | { type: 'import-preview'; rows: ListCsvRow[]; filename: string }
  | { type: 'import-error'; message: string }

const LIST_HEADER_ACTION_CLASS =
  'inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50'

export default function ListsPage() {
  useDocumentTitle('Lists')
  // Page-level clock for the per-card "X min ago" displays. One interval
  // for the whole grid; cards consume it via a `now` prop.
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

  const {
    inputRef: importInputRef,
    onChange: handleImportFile,
    openPicker: openImportPicker,
  } = useCsvFileInput<ListCsvRow>(parseListCsv, {
    onParsed: (rows, filename) => setDialog({ type: 'import-preview', rows, filename }),
    onError: (message) => setDialog({ type: 'import-error', message }),
  })

  // Current-list lifecycle actions (create / rename / duplicate / delete /
  // exportCsv). Shared with ListSettingsPanel via useCurrentListActions so
  // both surfaces invoke the same handlers - one canonical code path,
  // multiple entry points (card kebab here, List options popover/modal
  // there). createListMut navigates on success; this page owns closing the
  // create dialog via the call-site onSuccess.
  const { createListMut, submitCreateList, renameMut, duplicateMut, deleteListMut, exportCsv, exportingListId } =
    useCurrentListActions()

  // CSV-import-into-a-new-list. Shared hook owns the plan/preflight/POST
  // data path plus the success invalidate+navigate; this page owns closing
  // the dialog on success and routing failures into the import-error
  // dialog via the call-site onSuccess/onError below.
  const importMut = useListImportMutation()

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
              draft={dialog.draft}
              onChange={(v) => setDialog({ type: 'creating', draft: v })}
              onSubmit={() => {
                const trimmed = dialog.draft.trim()
                if (trimmed) submitCreateList(trimmed, { onSuccess: () => setDialog(null) })
                else setDialog(null)
              }}
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
              {/* List-management actions stay neutral here. A bright blue
                  primary button overpowered the otherwise flat gray/white
                  list manager. */}
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
            draft={dialog.draft}
            onChange={(v) => setDialog({ type: 'creating', draft: v })}
            onSubmit={() => {
              const trimmed = dialog.draft.trim()
              if (trimmed) submitCreateList(trimmed, { onSuccess: () => setDialog(null) })
              else setDialog(null)
            }}
            onCancel={() => setDialog(null)}
            saving={createListMut.isPending}
          />
        </div>
      )}

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
        <p className="text-sm text-gray-500">Loading…</p>
      ) : (() => {
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
                      now={now}
                      reorderPending={reorderPending}
                      {...rowHandlers(list)}
                    />
                  ))}
                </ul>
              </div>
            </SortableContext>
            <DragOverlay dropAnimation={null}>
              {activeList ? (
                // Overlay clone — a static row with a soft shadow so the
                // user can see what they're dragging. Wired to no-op
                // handlers because the overlay is purely visual; the
                // real row underneath still owns interaction.
                <div className={`${FLAT_TABLE_SURFACE} shadow-lg`}>
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
                      onShare={() => {}}
                      onExport={() => {}}
                      exporting={false}
                      onDuplicate={() => {}}
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

      {/* Import preview */}
      {dialog?.type === 'import-preview' && (
        <ListImportPreviewDialog
          rows={dialog.rows}
          saving={importMut.isPending}
          onConfirm={() =>
            importMut.mutate(
              { name: nameFromCsvFilename(dialog.filename), rows: dialog.rows },
              {
                onSuccess: () => setDialog(null),
                onError: (err) =>
                  setDialog({
                    type: 'import-error',
                    message: err instanceof Error ? err.message : 'Could not import CSV. Try again.',
                  }),
              },
            )
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
  const commitOnce = useCommitOnce()
  return (
    <div className="flex items-center gap-2">
      <input
        autoFocus
        type="text"
        placeholder="List name"
        value={draft}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commitOnce(onSubmit)
          if (e.key === 'Escape') commitOnce(onCancel)
        }}
        // Disabled while the create is in flight, matching the panel's
        // NewListInlineRow: the guard re-arms after the isPending
        // re-render (by design), so a second Enter mid-flight would
        // otherwise submit a duplicate.
        disabled={saving}
        className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      <button
        type="button"
        onClick={onSubmit}
        disabled={!draft.trim() || saving}
        className={`${LIST_HEADER_ACTION_CLASS} disabled:cursor-not-allowed disabled:opacity-50`}
      >
        <Plus size={14} /> Create
      </button>
      <button
        onClick={onCancel}
        aria-label="Cancel"
        className="rounded p-1.5 text-gray-500 hover:text-gray-600"
      >
        <X size={16} />
      </button>
    </div>
  )
}

type ListRowProps = {
  list: List
  // Page-level clock for relative-date display. Drilled down to RowMeta so
  // ListsPage owns one setInterval rather than one per row. Pre-fix,
  // formatRelativeDate read Date.now() at render time only, so a row that
  // mounted saying "1 min ago" stayed "1 min ago" forever.
  now: number
  renaming: boolean
  renameDraft: string
  onRenameDraftChange: (v: string) => void
  onStartRename: () => void
  onSubmitRename: () => void
  onCancelRename: () => void
  onShare: () => void
  onExport: () => void
  exporting: boolean
  onDuplicate: () => void
  onDelete: () => void
  // Sortable wrapper threads its dnd-kit ref + transform style + drag-
  // handle button through these. Omitted by the DragOverlay clone (no
  // useSortable in flight there).
  outerRef?: (el: HTMLElement | null) => void
  outerStyle?: React.CSSProperties
  dragHandle?: React.ReactNode
}

// Sortable wrapper for the row list. Wires the row's outer ref + transform
// style + drag-handle button via the shared useListCardSortable hook (see
// list-card-sortable.tsx) and forwards everything else to ListRow.
// Disabled while the row's rename input is open so the user can type
// without accidental drags, and while a previous reorder mutation is in
// flight to prevent the rollback-clobber race when two reorders overlap.
// gripIconSize=16 preserves the historic card-page row's grip size; the
// denser DesktopListsPanel row uses the hook's default 14.
function SortableListRow(
  props: Omit<ListRowProps, 'outerRef' | 'outerStyle' | 'dragHandle'> & { reorderPending?: boolean },
) {
  const { outerRef, outerStyle, dragHandle } = useListCardSortable({
    listId: props.list.id,
    listName: props.list.name,
    disabled: props.renaming || props.reorderPending,
    gripIconSize: 16,
  })
  return (
    <ListRow
      {...props}
      outerRef={outerRef}
      outerStyle={outerStyle}
      dragHandle={dragHandle}
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
  onShare,
  onExport,
  exporting,
  onDuplicate,
  onDelete,
  outerRef,
  outerStyle,
  dragHandle,
}: ListRowProps) {
  const { open: menuOpen, openMenu, close, triggerRef, menuRef, menuPos } =
    useAnchoredMenu({ variant: 'right-flush', menuWidth: 176 })
  const renameInputRef = useRef<HTMLInputElement>(null)
  const commitOnce = useCommitOnce()

  useEffect(() => {
    if (renaming) renameInputRef.current?.select()
  }, [renaming])

  // Row chrome: a flex strip inside the shared bordered container. No
  // hover-shadow — the container is the visual anchor, and a per-row
  // lift would re-introduce the card feel this refactor is replacing.
  // Hover bg is the same gray-50 every other interactive row in the app
  // uses (gear, list-detail, picker).
  //
  // Density routes through MOBILE_ROW_HEIGHT / DESKTOP_ROW_HEIGHT instead
  // of FLAT_TABLE_ROW because separators come from the container's
  // `divide-y` — a per-row `border-b` (which FLAT_TABLE_ROW carries) would
  // double the line between rows. py-2 stays inline: this row has more
  // chrome per line (name + date + count + kebab) than item rows, so the
  // extra vertical padding gives that chrome room to breathe; on desktop
  // the px-3 py-2 + content tends to push the row past the min-h-7 floor
  // anyway, so the height token mostly tracks the layer for future tuning.
  const rowClass =
    `relative flex ${MOBILE_ROW_HEIGHT} ${DESKTOP_ROW_HEIGHT} items-center gap-2 px-3 py-2 hover:bg-gray-50`

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
            if (e.key === 'Enter') commitOnce(onSubmitRename)
            if (e.key === 'Escape') commitOnce(onCancelRename)
          }}
          onBlur={() => commitOnce(onSubmitRename)}
          className={`flex-1 min-w-0 ${LIST_RENAME_INPUT_CLASS}`}
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
        className="min-w-0 flex-1 truncate rounded text-sm font-medium text-gray-900 focus:outline-none focus:underline focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1"
        aria-label={`Open ${list.name}`}
      >
        {list.name}
      </Link>
      {list.isDraft && <DraftBadge className="ml-2 shrink-0" />}

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
        aria-expanded={menuOpen}
        className={`${ROW_CONTROL_TARGET} shrink-0 text-gray-500 hover:bg-gray-100 hover:text-gray-600`}
      >
        <MoreVertical size={16} />
      </button>

      {menuOpen && menuPos && 'left' in menuPos && createPortal(
        <div
          ref={menuRef}
          role="group"
          aria-label={`${list.name} actions`}
          className={`fixed z-50 w-44 py-1 ${POPOVER_SURFACE}`}
          style={{ top: menuPos.top, left: menuPos.left }}
        >
          <RowMenuItem
            icon={<Pencil size={13} />}
            onClick={() => { close(); onStartRename() }}
          >
            Rename
          </RowMenuItem>
          <RowMenuItem icon={<Globe size={13} />} onClick={() => { close(); onShare() }}>
            Share…
          </RowMenuItem>
          <RowMenuItem
            icon={<Download size={13} />}
            onClick={() => { close(); onExport() }}
            disabled={exporting}
          >
            {exporting ? 'Exporting…' : 'Export CSV'}
          </RowMenuItem>
          <RowMenuItem icon={<CopyPlus size={13} />} onClick={() => { close(); onDuplicate() }}>
            Duplicate
          </RowMenuItem>
          <RowMenuSeparator />
          <RowMenuItem icon={<Trash2 size={13} />} onClick={() => { close(); onDelete() }} tone="danger">
            Delete
          </RowMenuItem>
        </div>,
        document.body,
      )}
    </li>
  )
}

function RowMeta({ list, now }: { list: List; now: number }) {
  const updated = formatRelativeDate(list.updatedAt, now)
  // Hidden on the smallest viewports so the row stays readable on a
  // narrow phone; comes back at sm+. tabular-nums keeps the column
  // visually steady as the relative time ticks.
  return (
    <span className="hidden sm:inline shrink-0 text-xs tabular-nums text-gray-500">
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
