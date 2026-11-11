import {
  COL_QTY,
  COL_WEIGHT,
  FLAT_TABLE_BODY_TEXT,
  FLAT_TABLE_QUANTITY_TEXT,
  PACK_ROW_WEIGHT_CELL,
  packIconSlot,
} from '../components/flat-table-styles'
import InlineWeight from '../components/InlineWeight'
import GearStatusBadge from '../components/gear/GearStatusBadge'
import type { ItemRowProps } from './ItemRow'
import { ConsumableIcon, WornIcon } from './list-item-flags'
import PackRowFrame from './PackRowFrame'

// A gear row in Pack mode: a checklist row with the name, worn/consumable
// status, quantity and weight. The skeleton (shell, grip slot, Ready
// checkbox, wrapping label, print squares) is PackRowFrame, shared with
// SortableFoodRow so gear and food read as one checklist; this file keeps
// only the gear-specific cells.
//
// It takes the same props object as ItemRow (section-parts buildRowProps),
// so SortableItemRow and PackSection pick between the two on `packMode`.
// Pack is authenticated-only: the public share page never renders this.
type Props = Pick<
  ItemRowProps,
  'item' | 'weightUnit' | 'onUpdate' | 'onSaveWeight' | 'dragHandle' | 'rowAction' | 'outerRef' | 'outerStyle'
>

export default function PackItemRow({
  item,
  weightUnit,
  onUpdate,
  onSaveWeight,
  dragHandle,
  rowAction,
  outerRef,
  outerStyle,
}: Props) {
  const name = item.gearItem.name
  const description = item.gearItem.description ?? ''
  const itemWeight = item.gearItem.weightGrams

  return (
    <PackRowFrame
      name={name}
      isPacked={item.isPacked}
      isReady={item.isReady}
      onUpdate={onUpdate}
      outerRef={outerRef}
      outerStyle={outerStyle}
      // Drag grip leads the row: Pack is where rows are reordered and
      // moved between locations.
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
      <span className={packIconSlot(item.isWorn)}>
        {item.isWorn && <WornIcon />}
      </span>
      <span className={packIconSlot(item.isConsumable)}>
        {item.isConsumable && <ConsumableIcon />}
      </span>
      <span className={`${COL_QTY} text-center ${FLAT_TABLE_QUANTITY_TEXT} text-gray-500`}>
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
          POPOVER_SURFACE. */}
      {rowAction}
    </PackRowFrame>
  )
}
