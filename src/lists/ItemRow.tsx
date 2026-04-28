import { useState, useRef, useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { CircleMinus, GripVertical, MoreVertical, Pencil, Shirt, Trash2, UtensilsCrossed } from 'lucide-react'
import type { ListItemWithGear } from '../lib/types'
import { formatItemWeight, type WeightUnit } from '../lib/weight'
import { asButtonRef } from '../lib/dnd'
import InlineText from '../components/InlineText'
import RowIconButton from '../components/RowIconButton'
import WeightInput from '../components/WeightInput'

// Single source of truth for a list item row. Used by both the authenticated
// list detail view and the public share view. Editing affordances are gated
// on whether the corresponding handler is passed:
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
  packMode?: boolean
  onUpdate?: (patch: Partial<Pick<ListItemWithGear, 'quantity' | 'is_worn' | 'is_consumable' | 'is_packed'>>) => void
  onSaveName?: (name: string) => void
  onSaveDescription?: (description: string) => void
  onSaveWeight?: (weight_grams: number) => void
  onDelete?: () => void
  onEditGearItem?: () => void
  onDeleteGearItem?: () => void
  dragHandle?: ReactNode
  outerRef?: (el: HTMLElement | null) => void
  outerStyle?: React.CSSProperties
}

export default function ItemRow({
  item,
  weightUnit,
  packMode = false,
  onUpdate,
  onSaveName,
  onSaveDescription,
  onSaveWeight,
  onDelete,
  onEditGearItem,
  onDeleteGearItem,
  dragHandle,
  outerRef,
  outerStyle,
}: Props) {
  const itemWeight = item.gear_item?.weight_grams ?? 0
  const [editingWeight, setEditingWeight] = useState(false)
  const [weightDraftGrams, setWeightDraftGrams] = useState(itemWeight)
  const weightInputRef = useRef<HTMLInputElement>(null)

  const [editingQty, setEditingQty] = useState(false)
  const [qtyDraft, setQtyDraft] = useState(String(item.quantity))
  const qtyInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { setWeightDraftGrams(itemWeight) }, [itemWeight])
  useEffect(() => { setQtyDraft(String(item.quantity)) }, [item.quantity])

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
    const clamped = isNaN(parsed) || parsed < 1 ? 1 : Math.min(parsed, 99)
    if (clamped !== item.quantity && onUpdate) onUpdate({ quantity: clamped })
    setEditingQty(false)
  }

  const name = item.gear_item?.name ?? '(deleted item)'
  const description = item.gear_item?.description ?? ''
  const editable = Boolean(onUpdate)
  const showKebab = Boolean(onDelete)

  // Pack mode: checklist row — name, worn/consumable status, qty
  if (packMode) {
    return (
      <div
        ref={outerRef}
        style={outerStyle}
        className={`flex items-center gap-1.5 border-b border-gray-100 px-3 py-0.5 text-sm transition-colors ${
          item.is_packed ? 'bg-green-50' : 'bg-white'
        }`}
      >
        <input
          type="checkbox"
          checked={item.is_packed}
          onChange={(e) => onUpdate?.({ is_packed: e.target.checked })}
          aria-label="Packed"
          className="h-4 w-4 rounded border-gray-300 text-blue-600 shrink-0"
        />
        <span
          className={`flex-1 min-w-0 truncate font-normal ${
            item.is_packed ? 'text-gray-400 line-through' : 'text-gray-900'
          }`}
        >
          {name}
        </span>
        <span className="shrink-0 w-7 inline-flex items-center justify-center">
          {item.is_worn && <Shirt size={14} className="text-purple-600" aria-label="Worn" />}
        </span>
        <span className="shrink-0 w-7 inline-flex items-center justify-center">
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
      className="group relative flex items-center gap-1.5 border-b border-gray-100 bg-white px-3 py-0.5 text-sm"
    >
      {dragHandle}

      {/* Desktop branch (≥ lg) — display:contents so children flow into the
          outer flex layout. Internal structure preserved verbatim from the
          interactive single-row layout that has shipped to date. */}
      <div className="hidden lg:contents">
        {/* Name + description as proportional columns — name : description = 2 : 3 */}
        <div className="flex-1 min-w-0 flex items-center gap-3">
          <div className="flex-[2] min-w-0">
            {onSaveName ? (
              <InlineText
                value={name}
                onSave={onSaveName}
                className="block w-full truncate font-normal text-gray-900"
              />
            ) : item.gear_item ? (
              <span className="block w-full truncate font-normal text-gray-900">{name}</span>
            ) : (
              <span className="block w-full truncate font-normal text-gray-400 italic">{name}</span>
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

        {/* Worn (Shirt) — toggle button when editable; static icon-only span otherwise */}
        {editable ? (
          <RowIconButton
            variant="purpleToggle"
            active={item.is_worn}
            onClick={() => onUpdate!({ is_worn: !item.is_worn, is_consumable: false })}
            title={item.is_worn ? 'Worn — click to clear' : 'Mark as worn'}
            ariaLabel={item.is_worn ? 'Worn — click to clear' : 'Mark as worn'}
            icon={<Shirt size={14} />}
          />
        ) : (
          <span className="shrink-0 w-7 inline-flex items-center justify-center">
            {item.is_worn && <Shirt size={14} className="text-purple-600" aria-label="Worn" />}
          </span>
        )}

        {/* Consumable (UtensilsCrossed) */}
        {editable ? (
          <RowIconButton
            variant="orangeToggle"
            active={item.is_consumable}
            onClick={() => onUpdate!({ is_consumable: !item.is_consumable, is_worn: false })}
            title={item.is_consumable ? 'Consumable — click to clear' : 'Mark as consumable'}
            ariaLabel={item.is_consumable ? 'Consumable — click to clear' : 'Mark as consumable'}
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
            max={99}
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
            onRemoveFromList={onDelete!}
            onEdit={onEditGearItem}
            onDeleteFromInventory={onDeleteGearItem}
          />
        )}
      </div>

      {/* Mobile branch (< lg) — visually mirrors the desktop row, but every
          in-row control renders as a static span (no buttons, no inputs, no
          focus rings, no aria-pressed). The whole row body is one tappable
          element that opens the edit dialog (or a non-interactive div when
          there's no edit handler — share view, "(deleted item)" rows). The
          kebab remains a real, focusable button next to it. */}
      <div className="lg:hidden flex flex-1 items-center gap-1.5">
        <MobileRowBody
          item={item}
          name={name}
          description={description}
          weightUnit={weightUnit}
          onTap={onEditGearItem}
        />
        {showKebab && (
          <RowKebab
            onRemoveFromList={onDelete!}
            onEdit={onEditGearItem}
            onDeleteFromInventory={onDeleteGearItem}
          />
        )}
      </div>
    </div>
  )
}

// Mobile row body — same column geometry as the desktop interactive row,
// but rendered with static <span> elements throughout. The wrapping element
// is a single <button> when an edit handler is provided (tap opens the edit
// dialog) and a plain <div> otherwise (read-only rows on the share view, or
// "(deleted item)" placeholders).
function MobileRowBody({
  item,
  name,
  description,
  weightUnit,
  onTap,
}: {
  item: ListItemWithGear
  name: string
  description: string
  weightUnit: WeightUnit
  onTap?: () => void
}) {
  const itemWeight = item.gear_item?.weight_grams ?? 0
  const cells = (
    <>
      {/* Name + description columns — same 2:3 ratio + typography as desktop */}
      <div className="flex-1 min-w-0 flex items-center gap-3">
        <div className="flex-[2] min-w-0">
          {item.gear_item ? (
            <span className="block w-full truncate font-normal text-gray-900">{name}</span>
          ) : (
            <span className="block w-full truncate font-normal text-gray-400 italic">{name}</span>
          )}
        </div>
        <div className="flex-[3] min-w-0">
          <span className="block w-full truncate text-sm font-normal text-gray-500">{description}</span>
        </div>
      </div>
      {/* Worn — static icon-only span (icon visible only when on) */}
      <span className="shrink-0 w-7 inline-flex items-center justify-center">
        {item.is_worn && <Shirt size={14} className="text-purple-600" aria-label="Worn" />}
      </span>
      {/* Consumable — static icon-only span */}
      <span className="shrink-0 w-7 inline-flex items-center justify-center">
        {item.is_consumable && <UtensilsCrossed size={14} className="text-orange-600" aria-label="Consumable" />}
      </span>
      {/* Quantity — static span */}
      <span className="shrink-0 w-12 text-right tabular-nums text-gray-600">
        {item.quantity}
      </span>
      {/* Weight — static span */}
      <span className="shrink-0 w-24 text-right tabular-nums text-gray-600">
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
        className="flex flex-1 min-w-0 items-center gap-1.5 text-left"
      >
        {cells}
      </button>
    )
  }
  return <div className="flex flex-1 min-w-0 items-center gap-1.5">{cells}</div>
}

// Sortable wrapper for the authenticated list view. Calls useSortable, wires
// the row's outer ref + transform style + drag-handle button, and forwards
// everything else to ItemRow. Must be rendered inside a SortableContext.
export function SortableItemRow(props: Omit<Props, 'dragHandle' | 'outerRef' | 'outerStyle'>) {
  const {
    attributes,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: props.item.id, disabled: props.packMode })

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
// from list (always), Edit and Delete from inventory (only when there's a
// backing gear_item to act on; "(deleted item)" rows show only Remove).
// Each ItemRow owns its own popover state so multiple kebabs can't
// open at once and click-outside closes only the relevant menu.
function RowKebab({
  onRemoveFromList,
  onEdit,
  onDeleteFromInventory,
}: {
  onRemoveFromList: () => void
  onEdit?: () => void
  onDeleteFromInventory?: () => void
}) {
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuOpen = menuPos !== null

  useEffect(() => {
    if (!menuOpen) return
    function handleClick(e: MouseEvent) {
      const t = e.target as Node
      if (
        menuRef.current && !menuRef.current.contains(t) &&
        triggerRef.current && !triggerRef.current.contains(t)
      ) {
        setMenuPos(null)
      }
    }
    function handleScroll() { setMenuPos(null) }
    document.addEventListener('mousedown', handleClick)
    window.addEventListener('scroll', handleScroll, true)
    window.addEventListener('resize', handleScroll)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      window.removeEventListener('scroll', handleScroll, true)
      window.removeEventListener('resize', handleScroll)
    }
  }, [menuOpen])

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
          <MenuItem
            icon={<CircleMinus size={13} />}
            onClick={() => { setMenuPos(null); onRemoveFromList() }}
          >
            Remove from list
          </MenuItem>
          {onEdit && (
            <MenuItem icon={<Pencil size={13} />} onClick={() => { setMenuPos(null); onEdit() }}>
              Edit
            </MenuItem>
          )}
          {onDeleteFromInventory && (
            <>
              <div className="my-1 border-t border-gray-100" />
              <MenuItem
                icon={<Trash2 size={13} />}
                onClick={() => { setMenuPos(null); onDeleteFromInventory() }}
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
