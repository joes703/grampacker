import type { ReactNode } from 'react'
import { GripVertical } from 'lucide-react'
import type { FoodItemResponse } from '../../shared/food'
import { useSortableRow } from '../lib/use-sortable-row'
import type { WeightUnit } from '../lib/weight'
import InlineWeight from '../components/InlineWeight'
import RowIconButton from '../components/RowIconButton'
import {
  COL_ICON,
  COL_QTY,
  FLAT_TABLE_QUANTITY_TEXT,
  PACK_ROW_WEIGHT_CELL,
} from '../components/flat-table-styles'
import PackRowFrame from './PackRowFrame'
import { ConsumableIcon } from './list-item-flags'

// A food row in Pack mode - the food half of the 0022 union cohort. Mirrors
// the pack-mode branch of ItemRow (same tokens, same column skeleton: grip,
// checkboxes, name, worn/consumable slots, qty, row action) so gear and food
// read as one checklist, and wraps its own useSortable under the
// `packing-food-item:` id kind.
//
// Renders ONLY in the authenticated Pack view, so unlike ItemRow it may
// import @dnd-kit directly - no share-path bundling seam applies here.
type Props = {
  food: FoodItemResponse
  reorderPending: boolean
  weightUnit: WeightUnit
  onUpdate: (patch: { isPacked?: boolean; isReady?: boolean }) => void
  /** The move-to-location menu, injected like ItemRow's rowAction. */
  rowAction?: ReactNode
}

export default function SortableFoodRow({
  food,
  reorderPending,
  weightUnit,
  onUpdate,
  rowAction,
}: Props) {
  const { outerRef, outerStyle, handleProps } = useSortableRow({
    kind: 'packing-food-item',
    id: food.id,
    disabled: reorderPending,
  })

  return (
    <PackRowFrame
      name={food.name}
      isPacked={food.isPacked}
      isReady={food.isReady}
      onUpdate={onUpdate}
      outerRef={outerRef}
      outerStyle={outerStyle}
      dragHandle={
        <RowIconButton
          touchSafe
          {...handleProps}
          disabled={reorderPending}
          variant="dragHandle"
          ariaLabel={`Reorder or move ${food.name}`}
          icon={<GripVertical size={14} />}
        />
      }
      // No statusBadge and no description content: food has neither, and the
      // frame keeps the empty description slot for skeleton alignment with
      // gear rows at lg+.
    >
      {/* Worn slot stays empty (food is never worn); the consumable slot is
          always lit - food is consumable by definition, which is exactly why
          its grams already count toward consumable weight. */}
      <span className={`${COL_ICON} inline-flex items-center justify-center`} />
      <span className={`${COL_ICON} inline-flex items-center justify-center`}>
        <ConsumableIcon />
      </span>
      <span className={`${COL_QTY} text-center ${FLAT_TABLE_QUANTITY_TEXT} text-gray-500`}>
        {food.unitCount}
      </span>
      {/* Same component and the same PACK_ROW_WEIGHT_CELL as the gear pack row:
          a bag holds gear and food in one cohort, so a cell on one and not
          the other misaligns every column to its right in a mixed section.

          READ-ONLY on purpose - no onSave. A food item's weight is authored
          in the Food view, the same reason these rows carry no Remove and no
          Edit. Routing it through InlineWeight anyway means the two cells
          cannot drift apart the next time the control changes. */}
      <InlineWeight
        grams={food.weightGrams}
        unit={weightUnit}
        itemName={food.name}
        className={PACK_ROW_WEIGHT_CELL}
      />
      {rowAction}
    </PackRowFrame>
  )
}
