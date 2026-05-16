import { useState, useRef, useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { CircleMinus, GripVertical, MoreVertical, Pencil, Shirt, Trash2, UtensilsCrossed } from 'lucide-react'
import type { ListItemWithGear } from '../lib/types'
import type { GearStatus } from '../lib/gear-status'
import { formatItemWeight, type WeightUnit } from '../lib/weight'
import { asButtonRef } from '../lib/dnd'
import { makeDnDId } from '../lib/dnd-ids'
import { useAnchoredMenu } from '../lib/use-anchored-menu'
import InlineText from '../components/InlineText'
import RowIconButton from '../components/RowIconButton'
import WeightInput from '../components/WeightInput'
import GearStatusBadge from '../gear/GearStatusBadge'
import GearStatusMenuItems from '../gear/GearStatusMenuItems'

// Single source of truth for a list item row. Used by both the authenticated
// list detail view and the public share view.
//
// Responsive pattern (mobile vs. desktop split):
//   The non-pack-mode body renders ONE branch — the desktop subtree (full
//   inline-edit row: name + description, worn, consumable, qty, weight,
//   kebab) when `!isBelowLg`, or the mobile subtree (compact row that opens
//   the edit dialog on tap) when `isBelowLg`. The two layouts diverge
//   enough (column counts, icon-button affordances vs. modal-on-tap) that
//   branching is clearer than converging them with CSS alone. The JS gate
//   replaces a previous `hidden lg:contents` / `lg:hidden` CSS-only split,
//   which mounted both subtrees on every render even when invisible.
//
// Editing affordances are gated on whether the corresponding handler is passed:
//   - `onUpdate` enables Worn / Consumable toggle buttons (and the qty edit
//     button, since qty changes write through onUpdate).
//   - `onSaveName` / `onSaveDescription` enable inline-edit text via
//     `InlineText`; absent ⇒ static span with the same typography.
//   - `onSaveWeight` enables the clickable weight cell.
//   - `onDelete` (remove from list) enables the kebab. Without it, no kebab.
//   - `onEditGearItem` / `onDeleteGearItem` add the Edit / Delete-from-
//     inventory items to the kebab; without them the kebab shows only
//     "Remove from list".
//   - `dragHandle` injects a drag handle button (rendered absolute-left).
//     Provided by the SortableItemRow wrapper, omitted by share view.
//   - `outerRef` / `outerStyle` are the dnd-kit ref + transform style passed
//     by the sortable wrapper. Share view omits both.
//
// Pack-mode rendering branches early and only renders the checklist-style
// row (checkbox + name + status icons + qty). Pack mode is authed-only;
// share view never passes packMode.
type Props = {
  item: ListItemWithGear
  weightUnit: WeightUnit
  // Page-level breakpoint: true at <1024 px (Tailwind `lg:` boundary). Drilled
  // from the page (not via per-row hook) so a 300-row list registers one
  // matchMedia subscription, not 300. Set in sharedGroupProps.
  isBelowLg: boolean
  packMode?: boolean
  // Read by the SortableItemRow wrapper only; plain ItemRow ignores it. Lives
  // on the base Props so CategoryGroup's rowPropsFor() builder can spread the
  // same object into either renderer.
  reorderPending?: boolean
  // Pack-mode write-block: when true, the is_packed checkbox is disabled and
  // its onChange is a no-op. Set by ListDetailPage when navigator.onLine is
  // false — offline pack-mode is read-only by deliberate product choice (no
  // mutation outbox; honest capability boundary). Ignored outside pack mode.
  packActionsDisabled?: boolean
  onUpdate?: (patch: Partial<Pick<ListItemWithGear, 'quantity' | 'is_worn' | 'is_consumable' | 'is_packed'>>) => void
  onSaveName?: (name: string) => void
  onSaveDescription?: (description: string) => void
  onSaveWeight?: (weight_grams: number) => void
  onDelete?: () => void
  onEditGearItem?: () => void
  onDeleteGearItem?: () => void
  // Quick status setter for the row kebab. When provided alongside the
  // other gear handlers (private list view), the kebab gets the three-row
  // status sub-menu. Omitted on the share view, which can't mutate.
  onSetGearStatus?: (status: GearStatus) => void
  dragHandle?: ReactNode
  outerRef?: (el: HTMLElement | null) => void
  outerStyle?: React.CSSProperties
}

export default function ItemRow({
  item,
  weightUnit,
  isBelowLg,
  packMode = false,
  packActionsDisabled = false,
  onUpdate,
  onSaveName,
  onSaveDescription,
  onSaveWeight,
  onDelete,
  onEditGearItem,
  onDeleteGearItem,
  onSetGearStatus,
  dragHandle,
  outerRef,
  outerStyle,
}: Props) {
  const itemWeight = item.gear_item.weight_grams
  const [editingWeight, setEditingWeight] = useState(false)
  const [weightDraftGrams, setWeightDraftGrams] = useState(itemWeight)
  // Sync drafts to external prop changes via the React-docs "store-previous-prop"
  // pattern (https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes).
  // Drafts follow optimistic updates / cross-tab edits without remounting
  // the row mid-edit, and without the cascading-render pitfall flagged by
  // react-hooks/set-state-in-effect.
  const [prevItemWeight, setPrevItemWeight] = useState(itemWeight)
  if (itemWeight !== prevItemWeight) {
    setPrevItemWeight(itemWeight)
    setWeightDraftGrams(itemWeight)
  }
  const weightInputRef = useRef<HTMLInputElement>(null)

  const [editingQty, setEditingQty] = useState(false)
  const [qtyDraft, setQtyDraft] = useState(String(item.quantity))
  const [prevQty, setPrevQty] = useState(item.quantity)
  if (item.quantity !== prevQty) {
    setPrevQty(item.quantity)
    setQtyDraft(String(item.quantity))
  }
  const qtyInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editingWeight) weightInputRef.current?.focus()
  }, [editingWeight])
  useEffect(() => {
    if (editingQty) { qtyInputRef.current?.focus(); qtyInputRef.current?.select() }
  }, [editingQty])

  function commitWeight() {
    const clamped = Math.max(0, Math.min(weightDraftGrams, 100000))
    if (clamped !== itemWeight && onSaveWeight) onSaveWeight(clamped)
    setEditingWeight(false)
  }

  function commitQty() {
    const parsed = parseInt(qtyDraft, 10)
    const clamped = isNaN(parsed) || parsed < 1 ? 1 : Math.min(parsed, 9999)
    if (clamped !== item.quantity && onUpdate) onUpdate({ quantity: clamped })
    setEditingQty(false)
  }

  const name = item.gear_item.name
  const description = item.gear_item.description ?? ''
  const editable = Boolean(onUpdate)
  const showKebab = Boolean(onDelete)

  // Pack mode: checklist row — name, worn/consumable status, qty.
  // On mobile, the right-side stack (worn / consumable / qty) used to leave
  // visible empty space between the icon slots and the qty column. Tighter
  // gaps (gap-0.5) and narrower w/c slots (w-6) below lg pull them together
  // without changing the desktop layout.
  if (packMode) {
    return (
      <div
        ref={outerRef}
        style={outerStyle}
        className={`flex items-center gap-0.5 lg:gap-1.5 border-b border-gray-100 px-2 lg:px-3 py-2 lg:py-0.5 text-sm transition-colors ${
          item.is_packed ? 'bg-green-50 print:bg-transparent' : 'bg-white'
        }`}
      >
        {/* Wrapping label means clicking/tapping the name toggles packed,
            and screen readers announce the item name as the checkbox's
            accessible name (no separate aria-label needed).

            When packActionsDisabled is true, the input is `disabled` so
            click + keyboard activation are blocked at the platform level,
            and the onChange is also a no-op as defense in depth. */}
        <label className={`flex flex-1 min-w-0 items-center gap-1.5 lg:gap-1.5 ${packActionsDisabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}>
          <input
            type="checkbox"
            checked={item.is_packed}
            disabled={packActionsDisabled}
            onChange={(e) => {
              if (packActionsDisabled) return
              onUpdate?.({ is_packed: e.target.checked })
            }}
            title={packActionsDisabled ? 'Packing checkmark unavailable.' : undefined}
            className="h-4 w-4 rounded border-gray-300 text-blue-600 shrink-0 disabled:opacity-50 disabled:cursor-not-allowed print:hidden"
          />
          {/* Print-only empty checkbox. The native input above is suppressed
              in print because browsers render its checked state visually,
              and the printed sheet should be a blank checklist regardless
              of which items the user has already marked digitally. */}
          <span
            aria-hidden="true"
            className="hidden print:inline-block h-3.5 w-3.5 shrink-0 rounded-sm border border-gray-900"
          />
          {/* Status sits between the packed checkbox and the name. Badge
              returns null for 'active' so the common case takes no space;
              non-active rows pick up a small icon without disturbing the
              checkbox affordance. */}
          <GearStatusBadge status={item.gear_item.status} compact className="shrink-0 print:hidden" />
          {/* Name + description at lg+ in the same 2:3 proportion as edit
              mode. <lg keeps the single-column name-only layout (mirrors
              MobileRowBody's edit-mode treatment of dropping description
              on small viewports). */}
          <div className="flex flex-1 min-w-0 items-center gap-3">
            <div className="flex-[2] min-w-0">
              <span
                className={`block w-full truncate font-normal ${
                  item.is_packed ? 'text-gray-400 line-through print:text-gray-900 print:no-underline' : 'text-gray-900'
                }`}
              >
                {name}
              </span>
            </div>
            <div className="hidden lg:block lg:flex-[3] min-w-0">
              <span
                className={`block w-full truncate text-sm font-normal ${
                  item.is_packed ? 'text-gray-300 line-through print:text-gray-600 print:no-underline' : 'text-gray-500'
                }`}
              >
                {description}
              </span>
            </div>
          </div>
        </label>
        <span className="shrink-0 w-6 lg:w-7 inline-flex items-center justify-center">
          {item.is_worn && <Shirt size={14} className="text-purple-600" aria-label="Worn" />}
        </span>
        <span className="shrink-0 w-6 lg:w-7 inline-flex items-center justify-center">
          {item.is_consumable && <UtensilsCrossed size={14} className="text-orange-600" aria-label="Consumable" />}
        </span>
        <span className="shrink-0 w-10 text-right tabular-nums text-xs text-gray-500">
          {item.quantity}
        </span>
      </div>
    )
  }

  // Normal (edit / read-only) row: aligned columns matching the category header
  return (
    <div
      ref={outerRef}
      style={outerStyle}
      className="group relative flex items-center gap-1.5 border-b border-gray-100 bg-white px-3 py-2 lg:py-0.5 text-sm"
    >
      {dragHandle}

      {isBelowLg ? (
        /* Mobile branch (< lg) — name + single worn/consumable slot + qty +
           weight, rendered as static spans. Description and kebab are
           intentionally dropped: editing happens in the modal that opens on
           row tap. Read-only rows (share view) render as a non-interactive
           div instead of a button. */
        <div className="flex flex-1 items-center gap-1">
          <MobileRowBody
            item={item}
            name={name}
            weightUnit={weightUnit}
            onTap={onEditGearItem}
          />
        </div>
      ) : (
        /* Desktop branch (≥ lg) — display:contents so children flow into the
           outer flex layout. Internal structure preserved verbatim from the
           interactive single-row layout that has shipped to date. */
        <>
        {/* Name + description as proportional columns — name : description = 2 : 3.
            Status badge is the first thing inside the name cell; null-for-
            active means active rows reserve no extra whitespace, while
            non-active rows pick up a subtle leading icon. */}
        <div className="flex-1 min-w-0 flex items-center gap-3">
          <div className="flex-[2] min-w-0 flex items-center gap-1.5">
            <GearStatusBadge status={item.gear_item.status} compact className="shrink-0 print:hidden" />
            {onSaveName ? (
              <InlineText
                value={name}
                onSave={onSaveName}
                className="block min-w-0 flex-1 truncate font-normal text-gray-900"
              />
            ) : (
              <span className="block min-w-0 flex-1 truncate font-normal text-gray-900">{name}</span>
            )}
          </div>
          <div className="flex-[3] min-w-0">
            {onSaveDescription ? (
              <InlineText
                value={description}
                placeholder="Add description"
                onSave={onSaveDescription}
                className="block w-full truncate text-sm font-normal text-gray-500"
              />
            ) : (
              <span className="block w-full truncate text-sm font-normal text-gray-500">{description}</span>
            )}
          </div>
        </div>

        {/* Worn (Shirt) — toggle button when editable; static icon-only span otherwise.
            Branch on `onUpdate` directly (not the derived `editable` bool) so
            TS narrows the function type inside the truthy branch. */}
        {onUpdate ? (
          <RowIconButton
            variant="purpleToggle"
            active={item.is_worn}
            onClick={() => onUpdate({ is_worn: !item.is_worn, is_consumable: false })}
            title={item.is_worn ? 'Worn. Click to clear.' : 'Mark as worn'}
            ariaLabel={item.is_worn ? 'Worn. Click to clear.' : 'Mark as worn'}
            icon={<Shirt size={14} />}
          />
        ) : (
          <span className="shrink-0 w-7 inline-flex items-center justify-center">
            {item.is_worn && <Shirt size={14} className="text-purple-600" aria-label="Worn" />}
          </span>
        )}

        {/* Consumable (UtensilsCrossed) */}
        {onUpdate ? (
          <RowIconButton
            variant="orangeToggle"
            active={item.is_consumable}
            onClick={() => onUpdate({ is_consumable: !item.is_consumable, is_worn: false })}
            title={item.is_consumable ? 'Consumable. Click to clear.' : 'Mark as consumable'}
            ariaLabel={item.is_consumable ? 'Consumable. Click to clear.' : 'Mark as consumable'}
            icon={<UtensilsCrossed size={14} />}
          />
        ) : (
          <span className="shrink-0 w-7 inline-flex items-center justify-center">
            {item.is_consumable && <UtensilsCrossed size={14} className="text-orange-600" aria-label="Consumable" />}
          </span>
        )}

        {/* Quantity — clickable when editable, static otherwise */}
        {editable && editingQty ? (
          <input
            ref={qtyInputRef}
            type="number"
            min={1}
            max={9999}
            value={qtyDraft}
            onChange={(e) => setQtyDraft(e.target.value)}
            onBlur={commitQty}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitQty()
              if (e.key === 'Escape') { setQtyDraft(String(item.quantity)); setEditingQty(false) }
            }}
            className="shrink-0 w-12 rounded border border-blue-400 px-1 py-0.5 text-right tabular-nums focus:outline-none"
          />
        ) : editable ? (
          <button
            onClick={() => setEditingQty(true)}
            title="Click to edit quantity"
            aria-label={`Quantity ${item.quantity} for ${name}, click to edit`}
            className="shrink-0 w-12 text-right tabular-nums text-gray-600 hover:text-blue-600"
          >
            {item.quantity}
          </button>
        ) : (
          <span className="shrink-0 w-12 text-right tabular-nums text-gray-600">
            {item.quantity}
          </span>
        )}

        {/* Weight — clickable when editable, static otherwise */}
        {onSaveWeight && editingWeight ? (
          <WeightInput
            inputRef={weightInputRef}
            grams={weightDraftGrams}
            onChange={setWeightDraftGrams}
            onBlur={commitWeight}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitWeight()
              if (e.key === 'Escape') { setWeightDraftGrams(itemWeight); setEditingWeight(false) }
            }}
            className="shrink-0 w-24"
            inputClassName="flex-1 min-w-0 rounded border border-blue-400 px-1 py-0.5 text-right tabular-nums focus:outline-none"
          />
        ) : onSaveWeight ? (
          <button
            onClick={() => setEditingWeight(true)}
            title="Click to edit weight"
            aria-label={`Weight ${formatItemWeight(itemWeight, weightUnit)} for ${name}, click to edit`}
            className="shrink-0 w-24 text-right tabular-nums text-gray-600 hover:text-blue-600"
          >
            {formatItemWeight(itemWeight, weightUnit)}
          </button>
        ) : (
          <span className="shrink-0 w-24 text-right tabular-nums text-gray-600">
            {formatItemWeight(itemWeight, weightUnit)}
          </span>
        )}

        {/* Kebab — Remove from list (always when handler present), Edit + Delete
            from inventory (only when handlers present). Hidden entirely on
            read-only rows. */}
        {showKebab && (
          <RowKebab
            currentStatus={item.gear_item.status}
            onRemoveFromList={onDelete!}
            onEdit={onEditGearItem}
            onDeleteFromInventory={onDeleteGearItem}
            onSetGearStatus={onSetGearStatus}
          />
        )}
        </>
      )}
    </div>
  )
}

// Mobile row body — name + a single worn/consumable indicator slot + qty +
// weight. Description is dropped on mobile (it's redundant with the modal
// editor and waste viewport on a 375 px screen). Worn and consumable share
// one slot since the DB CHECK constraint guarantees they're mutually
// exclusive. The wrapping element is a <button> when onTap is provided
// (tap opens the edit dialog) and a plain <div> otherwise.
function MobileRowBody({
  item,
  name,
  weightUnit,
  onTap,
}: {
  item: ListItemWithGear
  name: string
  weightUnit: WeightUnit
  onTap?: () => void
}) {
  const itemWeight = item.gear_item.weight_grams
  const cells = (
    <>
      <div className="flex-1 min-w-0 flex items-center gap-1.5">
        {/* Inline status badge — returns null for 'active' so the common
            case reserves no extra space. Worn/consumable stays in its own
            slot below so a worn item can also show "needs repair". */}
        <GearStatusBadge status={item.gear_item.status} compact className="shrink-0 print:hidden" />
        <span className="block min-w-0 flex-1 truncate font-normal text-gray-900">{name}</span>
      </div>
      {/* Single worn/consumable indicator slot */}
      <span className="shrink-0 w-6 inline-flex items-center justify-center">
        {item.is_worn ? (
          <Shirt size={14} className="text-purple-600" aria-label="Worn" />
        ) : item.is_consumable ? (
          <UtensilsCrossed size={14} className="text-orange-600" aria-label="Consumable" />
        ) : null}
      </span>
      <span className="shrink-0 w-8 text-right tabular-nums text-gray-600">
        {item.quantity}
      </span>
      <span className="shrink-0 w-20 text-right tabular-nums text-gray-600">
        {formatItemWeight(itemWeight, weightUnit)}
      </span>
    </>
  )
  if (onTap) {
    return (
      <button
        type="button"
        onClick={onTap}
        aria-label="Edit item"
        className="flex flex-1 min-w-0 items-center gap-2 text-left"
      >
        {cells}
      </button>
    )
  }
  return <div className="flex flex-1 min-w-0 items-center gap-2">{cells}</div>
}

// Sortable wrapper for the authenticated list view. Calls useSortable, wires
// the row's outer ref + transform style + drag-handle button, and forwards
// everything else to ItemRow. Must be rendered inside a SortableContext.
// Drag is disabled in pack mode (structural changes inert while checking
// off items) and while a previous reorder mutation is in flight (prevents
// the rollback-clobber race when two reorders overlap).
export function SortableItemRow(props: Omit<Props, 'dragHandle' | 'outerRef' | 'outerStyle'>) {
  const {
    attributes,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: makeDnDId('item', props.item.id),
    disabled: props.packMode || props.reorderPending,
  })

  const sortableStyle: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  }

  const handle = (
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
    <ItemRow
      {...props}
      dragHandle={props.packMode ? undefined : handle}
      outerRef={setNodeRef}
      outerStyle={sortableStyle}
    />
  )
}

// Kebab popover — three-dot button + portal-rendered menu. Items: Remove
// from list (always), Edit and Delete from inventory (only when those
// handlers are passed). Each ItemRow owns its own popover state so
// multiple kebabs can't open at once and click-outside closes only the
// relevant menu.
function RowKebab({
  currentStatus,
  onRemoveFromList,
  onEdit,
  onDeleteFromInventory,
  onSetGearStatus,
}: {
  currentStatus: GearStatus
  onRemoveFromList: () => void
  onEdit?: () => void
  onDeleteFromInventory?: () => void
  onSetGearStatus?: (status: GearStatus) => void
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
          <MenuItem
            icon={<CircleMinus size={13} />}
            onClick={() => { close(); onRemoveFromList() }}
          >
            Remove from list
          </MenuItem>
          {onEdit && (
            <MenuItem icon={<Pencil size={13} />} onClick={() => { close(); onEdit() }}>
              Edit
            </MenuItem>
          )}
          {onSetGearStatus && (
            <>
              <div className="my-1 border-t border-gray-100" />
              <GearStatusMenuItems
                current={currentStatus}
                onSelect={(s) => { close(); onSetGearStatus(s) }}
              />
            </>
          )}
          {onDeleteFromInventory && (
            <>
              <div className="my-1 border-t border-gray-100" />
              <MenuItem
                icon={<Trash2 size={13} />}
                onClick={() => { close(); onDeleteFromInventory() }}
                danger
              >
                Delete from inventory
              </MenuItem>
            </>
          )}
        </div>,
        document.body,
      )}
    </>
  )
}

function MenuItem({ icon, children, onClick, danger }: { icon: React.ReactNode; children: React.ReactNode; onClick: () => void; danger?: boolean }) {
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
