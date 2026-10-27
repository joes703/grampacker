import { Link } from 'react-router'
import { CopyPlus, Download, Globe, MoreVertical, Pencil, Plus, Trash2, X } from 'lucide-react'
import type { List } from '../lib/types'
import DraftBadge from '../components/DraftBadge'
import KebabMenu from '../components/KebabMenu'
import InlineRenameInput from '../components/InlineRenameInput'
import { RowMenuItem, RowMenuSeparator } from '../components/RowMenuItem'
import {
  DESKTOP_ROW_HEIGHT,
  FLAT_TABLE_BODY_TEXT,
  FLAT_TABLE_ROW,
  MOBILE_ROW_HEIGHT,
  TOOLBAR_BUTTON,
} from '../components/flat-table-styles'
import { useCommitOnce } from '../lib/use-commit-once'
import { useListCardSortable, LIST_RENAME_INPUT_CLASS } from './list-card-sortable'

// The one lists-surface row, shared by /lists (variant 'page') and the
// desktop lists panel on /lists/:id (variant 'panel'). The two surfaces
// used to carry near-identical copies - same rename-inline swap, same kebab
// wiring, same sortable wrapper - that had to agree change-for-change.
// What genuinely differs stays keyed on `variant`:
//   - chrome: the page row is the roomier /lists manager row with the
//     "Updated ..." meta; the panel row tracks FLAT_TABLE_ROW density and
//     carries the current-list highlight.
//   - menu: the page offers Share (sharing lives in List options inside the
//     open list, so the panel deliberately does not) and orders
//     Rename/Share/Export/Duplicate; the panel orders Rename/Duplicate/
//     Export.
//
// Presentation and behavior are SPLIT: `actions` carries every handler, and
// the DragOverlay clones omit it entirely instead of stubbing a dozen no-op
// props - the row then renders static, with the kebab disabled.

export type ListRowVariant = 'page' | 'panel'

export type ListRowActions = {
  renaming: boolean
  renameDraft: string
  onRenameDraftChange: (v: string) => void
  onStartRename: () => void
  onSubmitRename: () => void
  onCancelRename: () => void
  // Page only; the panel never passes it (see the variant note above).
  onShare?: () => void
  onExport: () => void
  exporting: boolean
  onDuplicate: () => void
  onDelete: () => void
}

type ListRowProps = {
  list: List
  variant: ListRowVariant
  // Page-level clock for the page variant's relative-date meta. The page
  // owns one setInterval rather than one per row; pre-fix, a row that
  // mounted saying "1 min ago" stayed "1 min ago" forever.
  now?: number
  // Panel only: soft blue tint + medium-weight name marks the open list.
  isCurrent?: boolean
  // Omitted by the DragOverlay clones: the overlay is purely visual, the
  // real row underneath owns interaction.
  actions?: ListRowActions
  // Sortable wrapper threads its dnd-kit ref + transform style + drag-
  // handle button through these. Omitted by the DragOverlay clone (no
  // useSortable in flight there).
  outerRef?: (el: HTMLElement | null) => void
  outerStyle?: React.CSSProperties
  dragHandle?: React.ReactNode
}

// Sortable wrapper. Wires the row's outer ref + transform style + drag-
// handle button via the shared useListCardSortable hook and forwards
// everything else to ListRow. Disabled while the row's rename input is open
// so the user can type without accidental drags, and while a previous
// reorder mutation is in flight to prevent the rollback-clobber race when
// two reorders overlap. gripIconSize 16 preserves the historic /lists row's
// grip size; the denser panel row uses the hook's default 14.
export function SortableListRow(
  props: Omit<ListRowProps, 'outerRef' | 'outerStyle' | 'dragHandle'> & {
    actions: ListRowActions
    reorderPending?: boolean
  },
) {
  const { outerRef, outerStyle, dragHandle } = useListCardSortable({
    listId: props.list.id,
    listName: props.list.name,
    disabled: props.actions.renaming || props.reorderPending,
    gripIconSize: props.variant === 'page' ? 16 : undefined,
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

export function ListRow({
  list,
  variant,
  now,
  isCurrent = false,
  actions,
  outerRef,
  outerStyle,
  dragHandle,
}: ListRowProps) {
  // Page chrome: a flex strip inside the shared bordered container. No
  // hover-shadow - the container is the visual anchor. Density routes
  // through MOBILE/DESKTOP_ROW_HEIGHT instead of FLAT_TABLE_ROW because the
  // page container's `divide-y` owns the separators - a per-row border-b
  // would double the line. py-2 stays inline: this row has more chrome per
  // line (name + date + kebab) than item rows.
  //
  // Panel chrome: FLAT_TABLE_ROW so the row tracks the shared density
  // layer, plus the current-list highlight.
  const rowClass =
    variant === 'page'
      ? `relative flex ${MOBILE_ROW_HEIGHT} ${DESKTOP_ROW_HEIGHT} items-center gap-2 px-3 py-2 hover:bg-gray-50`
      : `${FLAT_TABLE_ROW} w-full gap-2 px-3 py-0 ${isCurrent ? 'bg-blue-50' : ''} hover:bg-gray-100`

  // Renaming swaps the name link for an input. The kebab is hidden during
  // rename to keep the focused control unambiguous; Enter / Escape / blur
  // on the input commits or cancels.
  if (actions?.renaming) {
    return (
      <li ref={outerRef as React.Ref<HTMLLIElement>} style={outerStyle} className={rowClass}>
        {dragHandle}
        <InlineRenameInput
          value={actions.renameDraft}
          onChange={actions.onRenameDraftChange}
          onSubmit={actions.onSubmitRename}
          onCancel={actions.onCancelRename}
          className={`min-w-0 flex-1 ${LIST_RENAME_INPUT_CLASS}`}
        />
      </li>
    )
  }

  return (
    <li ref={outerRef as React.Ref<HTMLLIElement>} style={outerStyle} className={rowClass}>
      {dragHandle}

      {/* Name is the primary click target; takes whatever flex room the
          meta and kebab leave behind. truncate caps long names rather than
          wrapping the row. A Link (not a button) so middle-click /
          cmd-click open in a new tab. */}
      <Link
        to={`/lists/${list.id}`}
        className={
          variant === 'page'
            ? 'min-w-0 flex-1 truncate rounded text-sm font-medium text-gray-900 focus:outline-none focus:underline focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1'
            : `min-w-0 flex-1 truncate ${FLAT_TABLE_BODY_TEXT} ${
                isCurrent ? 'font-medium text-gray-900' : 'font-normal text-gray-700'
              } focus:outline-none focus:underline`
        }
        aria-label={`Open ${list.name}`}
        aria-current={variant === 'panel' && isCurrent ? 'page' : undefined}
      >
        {list.name}
      </Link>
      {list.isDraft && <DraftBadge className="ml-2 shrink-0" />}

      {variant === 'page' && now !== undefined && <RowMeta list={list} now={now} />}

      {/* Kebab. Hidden during rename above; disabled (static) on the
          actionless DragOverlay clone. */}
      <KebabMenu
        touchSafe
        width={44}
        icon={variant === 'page' ? <MoreVertical size={16} /> : undefined}
        ariaLabel="List options"
        menuLabel={`${list.name} actions`}
        disabled={!actions}
      >
        {({ close }) =>
          actions ? (
            <>
              <RowMenuItem
                icon={<Pencil size={13} />}
                onClick={() => {
                  close()
                  actions.onStartRename()
                }}
              >
                Rename
              </RowMenuItem>
              {variant === 'page' && actions.onShare && (
                <RowMenuItem
                  icon={<Globe size={13} />}
                  onClick={() => {
                    close()
                    actions.onShare?.()
                  }}
                >
                  Share…
                </RowMenuItem>
              )}
              {variant === 'panel' && (
                <RowMenuItem
                  icon={<CopyPlus size={13} />}
                  onClick={() => {
                    close()
                    actions.onDuplicate()
                  }}
                >
                  Duplicate
                </RowMenuItem>
              )}
              <RowMenuItem
                icon={<Download size={13} />}
                onClick={() => {
                  close()
                  actions.onExport()
                }}
                disabled={actions.exporting}
              >
                {actions.exporting ? 'Exporting…' : 'Export CSV'}
              </RowMenuItem>
              {variant === 'page' && (
                <RowMenuItem
                  icon={<CopyPlus size={13} />}
                  onClick={() => {
                    close()
                    actions.onDuplicate()
                  }}
                >
                  Duplicate
                </RowMenuItem>
              )}
              <RowMenuSeparator />
              <RowMenuItem
                icon={<Trash2 size={13} />}
                onClick={() => {
                  close()
                  actions.onDelete()
                }}
                tone="danger"
              >
                Delete
              </RowMenuItem>
            </>
          ) : null
        }
      </KebabMenu>
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

// Header-action chrome shared by the /lists header buttons and the header
// variant of NewListInline below. List-management actions stay neutral: a
// bright blue primary button overpowered the otherwise flat gray/white list
// manager.
export const LIST_HEADER_ACTION_CLASS =
  `inline-flex items-center gap-1.5 ${TOOLBAR_BUTTON}`

// The inline "New list" draft input, shared by the /lists header (variant
// 'header': input + Create + cancel) and the panel's first-row slot (variant
// 'row': bare row-styled input whose blur also submits). Disabled while the
// create is in flight: the commit-once guard re-arms after the isPending
// re-render (by design), so a second Enter mid-flight would otherwise submit
// a duplicate.
export function NewListInline({
  variant,
  draft,
  saving,
  onChange,
  onSubmit,
  onCancel,
}: {
  variant: 'header' | 'row'
  draft: string
  saving: boolean
  onChange: (v: string) => void
  onSubmit: () => void
  onCancel: () => void
}) {
  const commitOnce = useCommitOnce()
  const input = (
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
      onBlur={variant === 'row' ? () => commitOnce(onSubmit) : undefined}
      disabled={saving}
      className={
        variant === 'header'
          ? 'rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'
          : 'min-w-0 flex-1 rounded border border-blue-400 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'
      }
    />
  )

  if (variant === 'row') {
    return <div className={`${FLAT_TABLE_ROW} w-full gap-2 px-3 py-0 bg-blue-50/40`}>{input}</div>
  }

  return (
    <div className="flex items-center gap-2">
      {input}
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
