import { type ReactNode } from 'react'
// This module is on the public share view's critical path
// (SharePage -> CategoryGroup -> ItemRow), and a share view is read-only: it
// can never drag anything. A VALUE import from @dnd-kit here would pull the
// whole drag-and-drop library into the anonymous bundle. That is exactly what
// SortableItemRow living in this file used to do - hence SortableItemRow.tsx.
import { CircleMinus, Pencil, Shirt, UtensilsCrossed } from 'lucide-react'
import type { ListItemWithGear } from '../lib/types'
import type { GearStatus } from '../lib/gear-status'
import { formatItemWeight, type WeightUnit } from '../lib/weight'
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
  FLAT_TABLE_NUMERIC_TEXT,
  FLAT_TABLE_QUANTITY_TEXT,
  PACK_ROW_WEIGHT_CELL,
  itemRowShell,
} from '../components/flat-table-styles'
import ItemWeightValue from '../components/ItemWeightValue'
import { MobileRowBody, NameDescriptionCell } from '../components/ItemRowScaffold'
import PackRowFrame from './PackRowFrame'
import { RowMenuItem, RowMenuSeparator } from '../components/RowMenuItem'
import SwipeableRow from '../components/SwipeableRow'
import InlineWeight from '../components/InlineWeight'
import InlineQuantity from '../components/InlineQuantity'
import GearStatusBadge from '../components/gear/GearStatusBadge'
import GearStatusMenuItems from '../components/gear/GearStatusMenuItems'
import { WornIcon, ConsumableIcon } from './list-item-flags'
import { MAX_LIST_ITEM_QUANTITY } from '../lib/caps'

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
//   - `onEditGearItem` adds the Edit item to the kebab; without it the
//     kebab shows only "Remove from list". Deleting from inventory is
//     deliberately absent here - see RowKebab below.
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

  // Pack mode: checklist row — name, worn/consumable status, qty. The
  // skeleton (shell, grip slot, Ready checkbox, wrapping label, print
  // squares) is PackRowFrame, shared with SortableFoodRow so gear and food
  // read as one checklist; this file keeps only the gear-specific cells.
  if (packMode) {
    return (
      <PackRowFrame
        name={name}
        isPacked={item.isPacked}
        isReady={item.isReady}
        onUpdate={onUpdate}
        outerRef={outerRef}
        outerStyle={outerStyle}
        // Drag grip leads the row, matching the organizer row this replaced.
        // Pack mode used to render none: structural changes were considered
        // inert while checking items off, so reordering and moving between
        // locations lived in a separate Organize view. Pack IS that view now.
        dragHandle={dragHandle}
        // Status sits between the packed checkbox and the name. Badge
        // returns null for 'active' so the common case takes no space.
        statusBadge={
          <GearStatusBadge status={item.gearItem.status} compact className="shrink-0 print:hidden" />
        }
        description={
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
        }
      >
        <span className={`${COL_ICON} inline-flex items-center justify-center`}>
          {item.isWorn && <WornIcon />}
        </span>
        <span className={`${COL_ICON} inline-flex items-center justify-center`}>
          {item.isConsumable && <ConsumableIcon />}
        </span>
        <span className={`${COL_QTY} text-right ${FLAT_TABLE_QUANTITY_TEXT} text-gray-500`}>
          {item.quantity}
        </span>
        {/* Weight. A SIBLING of the frame's label, never a child (the frame
            header owns the rule: anything inside the label joins the Packed
            toggle gesture). Name and description sit inside the label and so
            stay in the dialog; weight is the one field you actually want to
            fix while packing, and it happens to be the one that can be.

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
      </PackRowFrame>
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

  // Normal (edit / read-only) row: aligned columns matching the category
  // header. The shell recipe (and its px-3 mobile inset rationale) lives in
  // itemRowShell, shared with GearItemRow.
  return (
    <div ref={outerRef} style={outerStyle} className={itemRowShell(mobileSwipe)}>
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
            <ListMobileRowBody
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
          <ListMobileRowBody
            item={item}
            name={name}
            weightUnit={weightUnit}
            onTap={onEditGearItem}
          />
        </div>
      ) : (
        /* Desktop branch (≥ lg). The name/description 2:3 cell is the shared
           NameDescriptionCell (editable per-handler, static on the share
           view); the columns after it are this surface's own. */
        <>
        <NameDescriptionCell
          status={item.gearItem.status}
          name={name}
          description={description}
          onSaveName={onSaveName}
          onSaveDescription={onSaveDescription}
        />

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

        {/* Kebab — Remove from list (always when handler present), Edit and
            the status shortcuts (only when handlers present). Hidden entirely
            on read-only rows. */}
        {showKebab && (
          <RowKebab
            currentStatus={item.gearItem.status}
            onRemoveFromList={onDelete!}
            onEdit={onEditGearItem}
            onSetGearStatus={onSetGearStatus}
          />
        )}
        </>
      )}
    </div>
  )
}

// This surface's mobile row: the shared badge+name body plus a single
// worn/consumable indicator slot, qty and weight. Description is dropped on
// mobile (it's redundant with the modal editor and waste viewport on a
// 375 px screen). Worn and consumable share one slot since the DB CHECK
// constraint guarantees they're mutually exclusive.
function ListMobileRowBody({
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
  return (
    <MobileRowBody
      status={item.gearItem.status}
      name={name}
      onTap={onTap}
      tapLabel={`Edit ${name}, quantity ${item.quantity}, ${itemWeightLabel}`}
    >
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
    </MobileRowBody>
  )
}

// Kebab popover — three-dot button + portal-rendered menu. Items: Remove
// from list (always), Edit and the status shortcuts (only when those
// handlers are passed). Each ItemRow owns its own popover state so
// multiple kebabs can't open at once and click-outside closes only the
// relevant menu.
//
// Deliberately NO "Delete from inventory" here. The list view shows "this
// item is on this trip"; deleting the gear item destroys it in every list,
// and the entry sat one row under the near-identical, harmless "Remove from
// list" (UX audits 2026-10). Deleting gear happens on the Gear page.
function RowKebab({
  currentStatus,
  onRemoveFromList,
  onEdit,
  onSetGearStatus,
}: {
  currentStatus: GearStatus
  onRemoveFromList: () => void
  onEdit?: () => void
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
        </>
      )}
    </KebabMenu>
  )
}
