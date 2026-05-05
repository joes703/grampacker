import { useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, MoreVertical, Pencil, Trash2 } from 'lucide-react'
import type { GearItem } from '../lib/types'
import { formatItemWeight, type WeightUnit } from '../lib/weight'
import { asButtonRef } from '../lib/dnd'
import { makeDnDId } from '../lib/dnd-ids'
import { usePortalPopover } from '../lib/use-portal-popover'
import InlineText from '../components/InlineText'
import RowIconButton from '../components/RowIconButton'

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
  // Drag plumbing — populated by SortableGearItemRow.
  dragHandle?: ReactNode
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
  dragHandle,
  outerRef,
  outerStyle,
}: Props) {
  return (
    <div
      ref={outerRef}
      style={outerStyle}
      className={`group relative flex items-center gap-1.5 border-b border-gray-100 bg-white px-3 py-0.5 text-sm ${
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
           its own onChange — no double-toggle. */
        <div className="flex flex-1 items-center gap-2">
          <button
            type="button"
            onClick={selectMode ? onToggleSelect : onEdit}
            aria-label={selectMode ? (selected ? 'Deselect item' : 'Select item') : 'Edit item'}
            className="flex flex-1 min-w-0 items-center gap-2 text-left"
          >
            <span className="flex-1 min-w-0 truncate font-normal text-gray-900">{item.name}</span>
            <span className="shrink-0 w-20 text-right tabular-nums text-gray-600">
              {formatItemWeight(item.weight_grams, weightUnit)}
            </span>
          </button>
        </div>
      ) : (
        /* Desktop branch (≥ lg) — name + description (2:3 cols), weight,
           and a kebab menu for Edit / Delete actions. The kebab pattern
           mirrors the list page's RowKebab so both pages share one row-
           action affordance. Hidden in select mode (selection itself
           replaces per-row actions). */
        <>
          <div className="flex-1 min-w-0 flex items-center gap-3">
            <div className="flex-[2] min-w-0">
              <InlineText
                value={item.name}
                onSave={(v) => onInlineSave({ name: v })}
                className="block w-full truncate font-normal text-gray-900"
              />
            </div>
            {(item.description !== null || !selectMode) && (
              <div className="flex-[3] min-w-0">
                <InlineText
                  value={item.description ?? ''}
                  placeholder="Add description"
                  onSave={(v) => onInlineSave({ description: v })}
                  className="block w-full truncate text-sm font-normal text-gray-500"
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
          {!selectMode && <GearRowKebab onEdit={onEdit} onDelete={onDelete} />}
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
function GearRowKebab({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) {
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuOpen = menuPos !== null

  usePortalPopover({
    isOpen: menuOpen,
    onClose: () => setMenuPos(null),
    triggerRef,
    contentRef: menuRef,
  })

  function openMenu() {
    if (!triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    const menuWidth = 192 // matches w-48
    setMenuPos({
      top: rect.bottom + 4,
      left: Math.max(8, rect.right - menuWidth),
    })
  }

  return (
    <>
      <RowIconButton
        ref={triggerRef}
        onClick={(e) => { e.stopPropagation(); if (menuOpen) setMenuPos(null); else openMenu() }}
        ariaLabel="Item options"
        icon={<MoreVertical size={14} />}
      />

      {menuOpen && menuPos && createPortal(
        <div
          ref={menuRef}
          className="fixed z-50 w-48 rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
          style={{ top: menuPos.top, left: menuPos.left }}
        >
          <MenuItem icon={<Pencil size={13} />} onClick={() => { setMenuPos(null); onEdit() }}>
            Edit
          </MenuItem>
          <div className="my-1 border-t border-gray-100" />
          <MenuItem
            icon={<Trash2 size={13} />}
            onClick={() => { setMenuPos(null); onDelete() }}
            danger
          >
            Delete from inventory
          </MenuItem>
        </div>,
        document.body,
      )}
    </>
  )
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

  const handle = props.selectMode ? undefined : (
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
      outerRef={setNodeRef}
      outerStyle={sortableStyle}
    />
  )
}
