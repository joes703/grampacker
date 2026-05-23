import { type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useSortable } from '@dnd-kit/sortable'
import type { DraggableSyntheticListeners } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, MoreVertical, Pencil, Trash2 } from 'lucide-react'
import type { GearItem } from '../lib/types'
import type { GearStatus } from '../lib/gear-status'
import { formatItemWeight, type WeightUnit } from '../lib/weight'
import { asButtonRef } from '../lib/dnd'
import { makeDnDId } from '../lib/dnd-ids'
import { useAnchoredMenu } from '../lib/use-anchored-menu'
import InlineText from '../components/InlineText'
import RowIconButton from '../components/RowIconButton'
import { RowMenuItem, RowMenuSeparator } from '../components/RowMenuItem'
import SwipeableRow from '../components/SwipeableRow'
import {
  FLAT_TABLE_BODY_TEXT,
  FLAT_TABLE_BODY_TEXT_MUTED,
  FLAT_TABLE_ROW,
} from '../components/flat-table-styles'
import GearStatusBadge from './GearStatusBadge'
import GearStatusMenuItems from './GearStatusMenuItems'

type Props = {
  item: GearItem
  weightUnit: WeightUnit
  // Page-level breakpoint: true at <1024 px (Tailwind `lg:` boundary). Drilled
  // from the page so a 500-row library registers one matchMedia subscription,
  // not 500.
  isBelowLg: boolean
  selectMode: boolean
  selected: boolean
  onToggleSelect: () => void
  onInlineSave: (patch: Partial<Pick<GearItem, 'name' | 'description'>>) => void
  onEdit: () => void
  onDelete: () => void
  onSetStatus: (status: GearStatus) => void
  // Drag plumbing — populated by SortableGearItemRow.
  dragHandle?: ReactNode
  // Touch reorder activator. On mobile the wrapper passes the dnd-kit
  // listeners here (instead of rendering a grip) so a press-and-hold on the
  // single tap-target row begins a drag; desktop keeps the hover grip. Drag
  // is disabled in select mode, so this is only set in normal mode.
  rowDragListeners?: DraggableSyntheticListeners
  outerRef?: (el: HTMLElement | null) => void
  outerStyle?: React.CSSProperties
}

export default function GearItemRow({
  item,
  weightUnit,
  isBelowLg,
  selectMode,
  selected,
  onToggleSelect,
  onInlineSave,
  onEdit,
  onDelete,
  onSetStatus,
  dragHandle,
  rowDragListeners,
  outerRef,
  outerStyle,
}: Props) {
  const mobileSwipe = isBelowLg && !selectMode

  const mobileBody = (
    <div className="flex flex-1 items-center gap-2">
      <button
        type="button"
        onClick={selectMode ? onToggleSelect : onEdit}
        aria-label={selectMode ? (selected ? 'Deselect item' : 'Select item') : 'Edit item'}
        className="flex flex-1 min-w-0 items-center gap-2 text-left"
      >
        {/* GearStatusBadge returns null for 'active' — non-active rows
            pick up a small leading icon, active rows take no space. */}
        <GearStatusBadge status={item.status} compact className="shrink-0 print:hidden" />
        <span className="flex-1 min-w-0 truncate font-normal text-gray-900">{item.name}</span>
        <span className="shrink-0 w-20 text-right tabular-nums text-gray-600">
          {formatItemWeight(item.weight_grams, weightUnit)}
        </span>
      </button>
    </div>
  )

  return (
    <div
      ref={outerRef}
      style={outerStyle}
      // rowDragListeners is set on mobile only (see Props). No touch-action:
      // none here — the TouchSensor press-and-hold delay separates scroll from
      // drag, so the library can scroll the list until a hold activates a drag.
      {...rowDragListeners}
      // px-3 mobile is intentional (not the canonical px-2 mobile ramp) — the
      // gear-inventory row has fewer columns than pack mode and reads better
      // with a uniform inset. lg:py-0 lets min-h-7 (28px) own the height on
      // desktop so the new density actually applies.
      className={`group relative ${FLAT_TABLE_ROW} ${FLAT_TABLE_BODY_TEXT} ${
        mobileSwipe ? '' : 'gap-1.5 bg-white px-3 py-2 lg:py-0'
      } ${
        selected ? 'bg-blue-50' : 'hover:bg-gray-50'
      }`}
    >
      {dragHandle}
      {selectMode && (
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          aria-label={selected ? `Deselect ${item.name}` : `Select ${item.name}`}
          className="h-4 w-4 rounded border-gray-300 text-blue-600"
        />
      )}

      {isBelowLg ? (
        /* Mobile branch (< lg) — name + weight only, no description, no
           inline icon buttons. The whole row body is one tappable button:
           tap toggles selection in select mode, otherwise opens the edit
           dialog. The leading checkbox (rendered above when selectMode is
           on) is a sibling of the button, so a checkbox tap only fires
           its own onChange — no double-toggle. In normal mode, a left
           swipe reveals Delete from inventory and hands off to the same
           confirm dialog as the kebab/edit-dialog delete path. */
        mobileSwipe ? (
          <SwipeableRow
            onAction={onDelete}
            label="Delete from inventory"
            icon={<Trash2 size={22} />}
            actionClassName="bg-red-600 text-white"
            actionArmedClassName="bg-red-600 text-white"
          >
            <div className="flex flex-1 items-center gap-1.5 px-3 py-2">
              {mobileBody}
            </div>
          </SwipeableRow>
        ) : (
          <div className="flex flex-1 items-center gap-1.5">
            {mobileBody}
          </div>
        )
      ) : (
        /* Desktop branch (≥ lg) — name + description (2:3 cols), weight,
           and a kebab menu for Edit / Delete actions. The kebab pattern
           mirrors the list page's RowKebab so both pages share one row-
           action affordance. Hidden in select mode (selection itself
           replaces per-row actions). */
        <>
          <div className="flex-1 min-w-0 flex items-center gap-3">
            <div className="flex-[2] min-w-0 flex items-center gap-1.5">
              {/* Inline status badge — null-for-active means no reserved
                  whitespace; non-active rows pick up a subtle leading icon. */}
              <GearStatusBadge status={item.status} compact className="shrink-0 print:hidden" />
              <InlineText
                value={item.name}
                onSave={(v) => onInlineSave({ name: v })}
                className="block min-w-0 flex-1 truncate font-normal text-gray-900"
              />
            </div>
            {(item.description !== null || !selectMode) && (
              <div className="flex-[3] min-w-0">
                <InlineText
                  value={item.description ?? ''}
                  placeholder="Add description"
                  onSave={(v) => onInlineSave({ description: v })}
                  className={`block w-full truncate ${FLAT_TABLE_BODY_TEXT_MUTED}`}
                />
              </div>
            )}
          </div>
          <span className="shrink-0 w-20 text-right tabular-nums text-gray-500">
            {formatCost(item.cost)}
          </span>
          <span className="shrink-0 w-24 text-right tabular-nums text-gray-500">
            {formatPurchaseDate(item.purchase_date)}
          </span>
          <span className="shrink-0 w-24 text-right tabular-nums text-gray-600">
            {formatItemWeight(item.weight_grams, weightUnit)}
          </span>
          {!selectMode && (
            <GearRowKebab
              status={item.status}
              onEdit={onEdit}
              onDelete={onDelete}
              onSetStatus={onSetStatus}
            />
          )}
        </>
      )}
    </div>
  )
}

// Cost is currency, formatted with commas + two decimals. Null renders
// as an em dash, never $0.00 — unknown is unknown. en-US locale matches
// our USD-only treatment (see GearItem.cost docstring).
const COST_FORMATTER = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
})
function formatCost(cost: number | null): string {
  if (cost === null) return '—'
  return COST_FORMATTER.format(cost)
}

// purchase_date arrives as ISO YYYY-MM-DD. Parsing as 'YYYY-MM-DDT00:00:00'
// keeps it in local-time so a 2024-04-15 entry doesn't render as Apr 14
// for users west of UTC. Output uses the user's locale via undefined-locale
// for readability ("Apr 15, 2024" in en-US).
//
// Hoisted because GearLibraryPage renders one cell per gear row;
// constructing a fresh Intl.DateTimeFormat per row was the audit-caught
// L9 cost. Locale is read once at module load — virtually no SPA
// respects mid-session locale changes anyway and we're not localizing
// anything else.
const DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
})
function formatPurchaseDate(date: string | null): string {
  if (date === null) return '—'
  const d = new Date(`${date}T00:00:00`)
  if (isNaN(d.getTime())) return '—'
  return DATE_FORMATTER.format(d)
}

// Kebab popover — three-dot button + portal-rendered menu. Mirrors
// `RowKebab` on the list page (src/lists/ItemRow.tsx) so both pages share
// one row-action pattern. Items: Edit (opens GearItemDialog), Delete from
// inventory (red, opens the confirm dialog). Each row owns its own popover
// state so multiple kebabs can't open at once and the dismiss listeners
// only target the relevant menu.
function GearRowKebab({
  status,
  onEdit,
  onDelete,
  onSetStatus,
}: {
  status: GearStatus
  onEdit: () => void
  onDelete: () => void
  onSetStatus: (s: GearStatus) => void
}) {
  const { open: menuOpen, openMenu, close, triggerRef, menuRef, menuPos } =
    useAnchoredMenu({ variant: 'right-flush', menuWidth: 192 })

  return (
    <>
      <RowIconButton
        ref={triggerRef}
        onClick={(e) => { e.stopPropagation(); if (menuOpen) close(); else openMenu() }}
        ariaLabel="Item options"
        icon={<MoreVertical size={14} />}
      />

      {menuOpen && menuPos && 'left' in menuPos && createPortal(
        <div
          ref={menuRef}
          role="menu"
          className="fixed z-50 w-48 rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
          style={{ top: menuPos.top, left: menuPos.left }}
        >
          <RowMenuItem icon={<Pencil size={13} />} onClick={() => { close(); onEdit() }}>
            Edit
          </RowMenuItem>
          <RowMenuSeparator />
          {/* Quick status — fast path that bypasses the full edit modal.
              Selecting the current status is a no-op inside the menu
              component; selecting a different status fires onSetStatus and
              we close the menu. */}
          <GearStatusMenuItems
            current={status}
            onSelect={(s) => { close(); onSetStatus(s) }}
          />
          <RowMenuSeparator />
          <RowMenuItem
            icon={<Trash2 size={13} />}
            onClick={() => { close(); onDelete() }}
            tone="danger"
          >
            Delete from inventory
          </RowMenuItem>
        </div>,
        document.body,
      )}
    </>
  )
}

// Sortable wrapper for the gear library page. Calls useSortable, wires the
// row's outer ref + transform style + a hover-revealed drag handle, then
// forwards everything to GearItemRow. Must be inside a SortableContext.
// Drag is disabled in select mode so the row's checkbox doesn't compete with
// the drag activator, and while a previous reorder mutation is in flight to
// prevent the rollback-clobber race when two reorders overlap.
export function SortableGearItemRow(
  props: Omit<Props, 'dragHandle' | 'outerRef' | 'outerStyle'> & { reorderPending?: boolean },
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
    id: makeDnDId('gear-item', props.item.id),
    disabled: props.selectMode || props.reorderPending,
  })

  const sortableStyle: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  }

  // Desktop uses the hover-revealed gutter grip. On mobile (isBelowLg) the
  // row itself is the long-press activator (listeners go on the row via
  // rowDragListeners) and the grip is not rendered. Select mode disables drag
  // entirely, so neither activator is wired there.
  const handle =
    props.selectMode || props.isBelowLg ? undefined : (
      <RowIconButton
        ref={asButtonRef(setActivatorNodeRef)}
        {...listeners}
        {...attributes}
        tabIndex={-1}
        variant="dragHandle"
        ariaLabel="Drag to reorder"
        icon={<GripVertical size={14} />}
        className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-full opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
      />
    )

  return (
    <GearItemRow
      {...props}
      dragHandle={handle}
      rowDragListeners={props.isBelowLg && !props.selectMode ? listeners : undefined}
      outerRef={setNodeRef}
      outerStyle={sortableStyle}
    />
  )
}
