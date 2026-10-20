import { type ReactNode } from 'react'
// This module is on the public share view's critical path
// (SharePage -> CategoryGroup -> ItemRow), and a share view is read-only: it
// can never drag anything. A VALUE import from @dnd-kit here would pull the
// whole drag-and-drop library into the anonymous bundle. That is exactly what
// SortableItemRow living in this file used to do - hence SortableItemRow.tsx.
import { CircleMinus, Pencil, Shirt, Trash2, UtensilsCrossed } from 'lucide-react'
import type { ListItemWithGear } from '../lib/types'
import type { GearStatus } from '../lib/gear-status'
import { formatItemWeight, type WeightUnit } from '../lib/weight'
import InlineText from '../components/InlineText'
import KebabMenu from '../components/KebabMenu'
import RowIconButton from '../components/RowIconButton'
import {
  COL_ICON,
  COL_QTY,
  COL_QTY_EDIT,
  COL_QTY_MOBILE,
  COL_WEIGHT,
  COL_WEIGHT_MOBILE,
  FLAT_TABLE_BODY_TEXT,
  FLAT_TABLE_BODY_TEXT_MUTED,
  FLAT_TABLE_NUMERIC_TEXT,
  FLAT_TABLE_QUANTITY_TEXT,
  FLAT_TABLE_ROW,
  FLAT_TABLE_ROW_PADDING,
  PACK_ROW_WEIGHT_CELL,
  PRINT_UNTRUNCATE,
} from '../components/flat-table-styles'
import ItemWeightValue from '../components/ItemWeightValue'
import { RowMenuItem, RowMenuSeparator } from '../components/RowMenuItem'
import SwipeableRow from '../components/SwipeableRow'
import InlineWeight from '../components/InlineWeight'
import InlineQuantity from '../components/InlineQuantity'
import GearStatusBadge from '../components/gear/GearStatusBadge'
import GearStatusMenuItems from '../components/gear/GearStatusMenuItems'
import { WornIcon, ConsumableIcon } from './list-item-flags'
import { MAX_LIST_ITEM_QUANTITY } from '../lib/caps'
import PackModeCheckbox from './PackModeCheckbox'

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
//   - `dragHandle` injects a drag handle button as the row's first in-flow
//     child. Provided by the SortableItemRow wrapper, omitted by share view.
//     (It used to sit in an absolutely-positioned outside-left gutter; that
//     was moved into the row because the flat table surface clips
//     out-of-surface children. See SortableItemRow.tsx.)
//   - `outerRef` / `outerStyle` are the dnd-kit ref + transform style passed
//     by the sortable wrapper. Share view omits both.
//
// Pack-mode rendering branches early and only renders the checklist-style
// row (checkbox + name + status icons + qty). Pack mode is authed-only;
// share view never passes packMode.
export type ItemRowProps = {
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
  onUpdate?: (patch: Partial<Pick<ListItemWithGear, 'quantity' | 'isWorn' | 'isConsumable' | 'isPacked' | 'isReady'>>) => void
  onSaveName?: (name: string) => void
  onSaveDescription?: (description: string) => void
  onSaveWeight?: (weightGrams: number) => void
  onDelete?: () => void
  onEditGearItem?: () => void
  onDeleteGearItem?: () => void
  // Quick status setter for the row kebab. When provided alongside the
  // other gear handlers (private list view), the kebab gets the three-row
  // status sub-menu. Omitted on the share view, which can't mutate.
  onSetGearStatus?: (status: GearStatus) => void
  dragHandle?: ReactNode
  // Trailing control on a PACK-mode row, injected as an opaque node (see the
  // matching note in CategoryGroup). Pack mode is now also the organizer, so
  // a row carries a "move to location" menu - the keyboard- and
  // touch-reachable equivalent of dragging it into another section. Injected
  // rather than built here because this module renders on the public share
  // view and must not import the authenticated packing components.
  rowAction?: ReactNode
  outerRef?: (el: HTMLElement | null) => void
  outerStyle?: React.CSSProperties
}

export default function ItemRow({
  item,
  weightUnit,
  isBelowLg,
  packMode = false,
  onUpdate,
  onSaveName,
  onSaveDescription,
  onSaveWeight,
  onDelete,
  onEditGearItem,
  onDeleteGearItem,
  onSetGearStatus,
  dragHandle,
  rowAction,
  outerRef,
  outerStyle,
}: ItemRowProps) {
  const itemWeight = item.gearItem.weightGrams
  // Weight editing lives in InlineWeight, quantity in InlineQuantity - one
  // control each, shared with the gear library row and (quantity) the food
  // carrying row. This used to hold quantity's own state machine, on the
  // grounds that it "has no second home"; food items got an editable quantity
  // and that stopped being true.

  const name = item.gearItem.name
  const description = item.gearItem.description ?? ''
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
        // gap-2 lg:gap-2.5 controls the space between the Ready checkbox
        // (left) and the wrapping label that hosts Packed + name. Bumped
        // from gap-0.5 lg:gap-1.5 so the two checkboxes don't read as
        // a single cluster on touch.
        className={`${FLAT_TABLE_ROW} ${FLAT_TABLE_BODY_TEXT} ${FLAT_TABLE_ROW_PADDING} gap-2 lg:gap-2.5 print:gap-1 transition-colors ${
          // Calmer "done" treatment than a green tint — the gray background
          // pairs with the text-gray-500 line-through inside the label to
          // read as completed without celebrating. print:bg-transparent
          // keeps the paper checklist visually neutral.
          item.isPacked ? 'bg-gray-50 print:bg-transparent' : 'bg-white'
        }`}
      >
        {/* Drag grip leads the row, matching the organizer row this replaced.
            Pack mode used to render none: structural changes were considered
            inert while checking items off, so reordering and moving between
            locations lived in a separate Organize view. Pack IS that view
            now. */}
        {dragHandle}
        {/* Ready checkbox sits OUTSIDE the wrapping label below so that
            clicking the row's name still toggles Packed (the muscle-memory
            destination). With implicit label association, the browser
            forwards a non-input click on the label to its FIRST nested
            input — putting Ready there would steal that gesture. Ready
            gets its own aria-label since it's no longer wrapped. */}
        <PackModeCheckbox
          variant="ready"
          checked={item.isReady}
          onChange={(checked) => onUpdate?.({ isReady: checked })}
          ariaLabel={`Mark ${name} ready`}
          title="Ready"
          standaloneLabel
        />
        <span
          aria-hidden="true"
          className="hidden print:inline-block h-3.5 w-3.5 shrink-0 rounded-sm border border-gray-900"
        />
        {/* Wrapping label means clicking/tapping the name toggles packed,
            and screen readers announce the item name as the checkbox's
            accessible name (no separate aria-label needed). */}
        <label className="flex flex-1 min-w-0 items-center gap-1.5 lg:gap-1.5 cursor-pointer">
          <PackModeCheckbox
            variant="packed"
            checked={item.isPacked}
            onChange={(checked) => onUpdate?.({ isPacked: checked })}
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
          <GearStatusBadge status={item.gearItem.status} compact className="shrink-0 print:hidden" />
          {/* Name + description at lg+ in the same 2:3 proportion as edit
              mode. <lg keeps the single-column name-only layout (mirrors
              MobileRowBody's edit-mode treatment of dropping description
              on small viewports). */}
          <div className="flex flex-1 min-w-0 items-center gap-3">
            <div className="flex-[2] min-w-0">
              <span
                className={`block w-full truncate ${PRINT_UNTRUNCATE} font-normal ${
                  item.isPacked ? 'text-gray-500 line-through print:text-gray-900 print:no-underline' : 'text-gray-900'
                }`}
              >
                {name}
              </span>
            </div>
            <div className="hidden lg:block lg:flex-[3] min-w-0">
              <span
                className={`block w-full truncate ${FLAT_TABLE_BODY_TEXT} font-normal ${
                  // gray-500, not gray-300: gray-300 is #d1d5dc, which is
                  // 1.41:1 against the bg-gray-50 a packed row sits on - not
                  // "faint", effectively invisible. A packed row is still
                  // operable (this is inside the label that unpacks it), so
                  // none of it is exempt as an inactive control. gray-500 is
                  // the lightest token that clears 4.5:1 there (4.63:1), which
                  // means the description can no longer fade a step further
                  // than the name; the line-through and the gray row carry
                  // "done" instead, and they carry it without relying on color.
                  item.isPacked ? 'text-gray-500 line-through print:text-gray-600 print:no-underline' : 'text-gray-500'
                }`}
              >
                {description}
              </span>
            </div>
          </div>
        </label>
        <span className={`${COL_ICON} inline-flex items-center justify-center`}>
          {item.isWorn && <WornIcon />}
        </span>
        <span className={`${COL_ICON} inline-flex items-center justify-center`}>
          {item.isConsumable && <ConsumableIcon />}
        </span>
        <span className={`${COL_QTY} text-right ${FLAT_TABLE_QUANTITY_TEXT} text-gray-500`}>
          {item.quantity}
        </span>
        {/* Weight. Deliberately a SIBLING of the label above, never a child:
            that label wraps the Packed checkbox, so anything inside it
            becomes part of the toggle gesture - a weight there would mark the
            item packed on click, and an INPUT there would be unusable.

            That boundary is what makes editing in place possible here at all.
            Name and description sit inside the label and so stay in the
            dialog; weight is the one field you actually want to fix while
            packing, and it happens to be the one that can be.

            lg+ only. The mobile pack row already drops its description for
            room, and a w-24 cell at 375px would crush the name - mobile Pack
            keeps the layout it has.

            print:hidden because the printed checklist keeps its existing
            geometry (the document column retains max-w-3xl under print: for
            the same reason). */}
        <InlineWeight
          grams={itemWeight}
          unit={weightUnit}
          onSave={onSaveWeight}
          itemName={name}
          className={PACK_ROW_WEIGHT_CELL}
          // While editing the cell becomes a flex row (input + unit toggle),
          // so it cannot keep inline-block.
          editingClassName={`hidden lg:flex ${COL_WEIGHT} print:hidden`}
        />
        {/* Packing menu (move to location / use as container). Not print-hidden
            here: the injected control is a RowIconButton, which carries
            print:hidden on its own base, and its portaled menu is hidden by
            POPOVER_SURFACE. This comment used to claim the same thing while
            NEITHER was true - an adversarial review caught it - so name the
            two places rather than asserting it happens somewhere. */}
        {rowAction}
      </div>
    )
  }

  // Swipe-to-remove is mobile-only and authed-only: onDelete is undefined on
  // the read-only share view, so share rows never become swipeable. In the
  // swipe case the padding/background move onto the swipe foreground so the
  // revealed action reaches the row edge, and the outer row keeps only its
  // separator border — crucially WITHOUT overflow-hidden, which would clip the
  // desktop gutter grip (the grip isn't rendered on mobile, so the swipe
  // wrapper owns its own overflow-hidden instead).
  const mobileSwipe = isBelowLg && Boolean(onDelete)

  // Normal (edit / read-only) row: aligned columns matching the category header
  return (
    <div
      ref={outerRef}
      style={outerStyle}
      // Non-pack normal row keeps px-3 mobile inline (not the canonical
      // FLAT_TABLE_ROW_PADDING px-2 mobile ramp) because the mobile read
      // body has fewer columns than pack mode, so a uniform px-3 inset
      // reads better than the tighter px-2. Desktop drops py-0 alongside
      // the new min-h-7 so the row reaches the 28px target.
      className={`group relative ${FLAT_TABLE_ROW} ${FLAT_TABLE_BODY_TEXT} ${
        mobileSwipe ? '' : 'gap-1.5 bg-white px-3 py-2 lg:py-0'
      }`}
    >
      {dragHandle}

      {mobileSwipe ? (
        /* Mobile authed row: swipe left to reveal Remove (full swipe fires the
           same removal action). Foreground carries the padding/bg so the action
           sits flush to the trailing edge. onDelete is non-null here
           (mobileSwipe gate). */
        <SwipeableRow
          onAction={onDelete!}
          label="Remove from list"
          icon={<CircleMinus size={22} />}
          allowFullSwipe
        >
          <div className="flex flex-1 items-center gap-1 px-3 py-2">
            <MobileRowBody
              item={item}
              name={name}
              weightUnit={weightUnit}
              onTap={onEditGearItem}
            />
          </div>
        </SwipeableRow>
      ) : isBelowLg ? (
        /* Mobile read-only (share) row — no swipe, no kebab; tap is inert. */
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
            <GearStatusBadge status={item.gearItem.status} compact className="shrink-0 print:hidden" />
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
              // allowEmpty: clearing removes the description; the page's
              // write boundary converts '' to the null the contract takes.
              <InlineText
                value={description}
                placeholder="Add description"
                allowEmpty
                onSave={onSaveDescription}
                className={`block w-full truncate ${FLAT_TABLE_BODY_TEXT_MUTED}`}
              />
            ) : (
              <span className={`block w-full truncate ${FLAT_TABLE_BODY_TEXT_MUTED}`}>{description}</span>
            )}
          </div>
        </div>

        {/* Worn (Shirt) — toggle button when editable; static icon-only span otherwise.
            Branch on `onUpdate` directly (not the derived `editable` bool) so
            TS narrows the function type inside the truthy branch. */}
        {onUpdate ? (
          <>
            <RowIconButton
              variant="purpleToggle"
              active={item.isWorn}
              onClick={() => onUpdate({ isWorn: !item.isWorn, isConsumable: false })}
              title={item.isWorn ? 'Worn. Clear worn status.' : 'Mark as worn'}
              ariaLabel={item.isWorn ? 'Worn. Clear worn status.' : 'Mark as worn'}
              icon={<Shirt size={14} />}
            />
            {/* The toggle above conveys DATA as well as an action - its active
                state is what says "this item is worn" - and RowIconButton is
                print:hidden everywhere. Without this the printed editable row
                silently loses the flag, while the read-only branch below keeps
                it. Same empty w-6 box when the flag is off, so the column rail
                stays aligned either way. */}
            <span className={`hidden print:inline-flex ${COL_ICON} items-center justify-center`}>
              {item.isWorn && <WornIcon />}
            </span>
          </>
        ) : (
          <span className={`${COL_ICON} inline-flex items-center justify-center`}>
            {item.isWorn && <WornIcon />}
          </span>
        )}

        {/* Consumable (UtensilsCrossed) */}
        {onUpdate ? (
          <>
            <RowIconButton
              variant="orangeToggle"
              active={item.isConsumable}
              onClick={() => onUpdate({ isConsumable: !item.isConsumable, isWorn: false })}
              title={item.isConsumable ? 'Consumable. Clear consumable status.' : 'Mark as consumable'}
              ariaLabel={item.isConsumable ? 'Consumable. Clear consumable status.' : 'Mark as consumable'}
              icon={<UtensilsCrossed size={14} />}
            />
            {/* Print-only static indicator; see the worn toggle above. */}
            <span className={`hidden print:inline-flex ${COL_ICON} items-center justify-center`}>
              {item.isConsumable && <ConsumableIcon />}
            </span>
          </>
        ) : (
          <span className={`${COL_ICON} inline-flex items-center justify-center`}>
            {item.isConsumable && <ConsumableIcon />}
          </span>
        )}

        {/* Quantity — clickable when editable, static otherwise */}
        <InlineQuantity
          quantity={item.quantity}
          max={MAX_LIST_ITEM_QUANTITY}
          onSave={editable && onUpdate ? (quantity) => onUpdate({ quantity }) : undefined}
          itemName={name}
          className={COL_QTY_EDIT}
        />

        {/* Weight — clickable when editable, static otherwise */}
        <InlineWeight
          grams={itemWeight}
          unit={weightUnit}
          onSave={onSaveWeight}
          itemName={name}
          className={`${COL_WEIGHT} text-gray-600`}
        />

        {/* Kebab — Remove from list (always when handler present), Edit + Delete
            from inventory (only when handlers present). Hidden entirely on
            read-only rows. */}
        {showKebab && (
          <RowKebab
            currentStatus={item.gearItem.status}
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
  const itemWeight = item.gearItem.weightGrams
  const itemWeightLabel = formatItemWeight(itemWeight, weightUnit)
  const cells = (
    <>
      <div className="flex-1 min-w-0 flex items-center gap-1.5">
        {/* Inline status badge — returns null for 'active' so the common
            case reserves no extra space. Worn/consumable stays in its own
            slot below so a worn item can also show "needs repair". */}
        <GearStatusBadge status={item.gearItem.status} compact className="shrink-0 print:hidden" />
        <span className="block min-w-0 flex-1 truncate font-normal text-gray-900">{name}</span>
      </div>
      {/* Single worn/consumable indicator slot */}
      <span className={`${COL_ICON} inline-flex items-center justify-center`}>
        {item.isWorn ? <WornIcon /> : item.isConsumable ? <ConsumableIcon /> : null}
      </span>
      <span className={`${COL_QTY_MOBILE} text-right ${FLAT_TABLE_QUANTITY_TEXT} text-gray-600`}>
        {item.quantity}
      </span>
      <span className={`${COL_WEIGHT_MOBILE} text-right ${FLAT_TABLE_NUMERIC_TEXT} text-gray-600`}>
        <ItemWeightValue grams={itemWeight} unit={weightUnit} />
      </span>
    </>
  )
  if (onTap) {
    return (
      <button
        type="button"
        onClick={onTap}
        aria-label={`Edit ${name}, quantity ${item.quantity}, ${itemWeightLabel}`}
        className="flex flex-1 min-w-0 items-center gap-2 text-left"
      >
        {cells}
      </button>
    )
  }
  return <div className="flex flex-1 min-w-0 items-center gap-2">{cells}</div>
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
  return (
    <KebabMenu ariaLabel="Item options" menuLabel="Item actions">
      {({ close }) => (
        <>
          <RowMenuItem
            icon={<CircleMinus size={13} />}
            onClick={() => { close(); onRemoveFromList() }}
            tone="removal"
          >
            Remove from list
          </RowMenuItem>
          {onEdit && (
            <RowMenuItem icon={<Pencil size={13} />} onClick={() => { close(); onEdit() }}>
              Edit
            </RowMenuItem>
          )}
          {onSetGearStatus && (
            <>
              <RowMenuSeparator />
              <GearStatusMenuItems
                current={currentStatus}
                onSelect={(s) => { close(); onSetGearStatus(s) }}
              />
            </>
          )}
          {onDeleteFromInventory && (
            <>
              <RowMenuSeparator />
              <RowMenuItem
                icon={<Trash2 size={13} />}
                onClick={() => { close(); onDeleteFromInventory() }}
                tone="danger"
              >
                Delete from inventory
              </RowMenuItem>
            </>
          )}
        </>
      )}
    </KebabMenu>
  )
}
