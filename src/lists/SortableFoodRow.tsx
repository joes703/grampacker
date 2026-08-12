import type { ReactNode } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical } from 'lucide-react'
import type { FoodItemResponse } from '../../shared/food'
import { asButtonRef } from '../lib/dnd'
import { makeDnDId } from '../lib/dnd-ids'
import type { WeightUnit } from '../lib/weight'
import InlineWeight from '../components/InlineWeight'
import RowIconButton from '../components/RowIconButton'
import {
  FLAT_TABLE_BODY_TEXT,
  FLAT_TABLE_QUANTITY_TEXT,
  FLAT_TABLE_ROW,
  FLAT_TABLE_ROW_PADDING,
} from '../components/flat-table-styles'
import PackModeCheckbox from './PackModeCheckbox'
import { ConsumableIcon } from './list-item-flags'
import { useIsPlacing } from './placement-context'

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
  const {
    attributes,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: makeDnDId('packing-food-item', food.id),
    disabled: reorderPending,
  })

  // Same placing tint as SortableItemRow: the row being click-to-placed
  // stays put and stays interactive, so it gets a marker, not the drag fade.
  const isPlacing = useIsPlacing(food.id)
  const sortableStyle: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    ...(isPlacing
      ? { backgroundColor: '#eff6ff', boxShadow: 'inset 3px 0 0 0 #60a5fa' }
      : null),
  }

  return (
    <div
      ref={setNodeRef}
      style={sortableStyle}
      className={`${FLAT_TABLE_ROW} ${FLAT_TABLE_BODY_TEXT} ${FLAT_TABLE_ROW_PADDING} gap-2 lg:gap-2.5 transition-colors ${
        food.isPacked ? 'bg-gray-50 print:bg-transparent' : 'bg-white'
      }`}
    >
      <RowIconButton
        touchSafe
        ref={asButtonRef(setActivatorNodeRef)}
        {...listeners}
        {...attributes}
        disabled={reorderPending}
        variant="dragHandle"
        ariaLabel={`Reorder or move ${food.name}`}
        icon={<GripVertical size={14} />}
      />
      <PackModeCheckbox
        variant="ready"
        checked={food.isReady}
        onChange={(checked) => onUpdate({ isReady: checked })}
        ariaLabel={`Mark ${food.name} ready`}
        title="Ready"
        standaloneLabel
      />
      <span
        aria-hidden="true"
        className="hidden print:inline-block h-3.5 w-3.5 shrink-0 rounded-sm border border-gray-900"
      />
      <label className="flex flex-1 min-w-0 items-center gap-1.5 lg:gap-1.5 cursor-pointer">
        <PackModeCheckbox
          variant="packed"
          checked={food.isPacked}
          onChange={(checked) => onUpdate({ isPacked: checked })}
        />
        <span
          aria-hidden="true"
          className="hidden print:inline-block h-3.5 w-3.5 shrink-0 rounded-sm border border-gray-900"
        />
        <div className="flex flex-1 min-w-0 items-center gap-3">
          <div className="flex-[2] min-w-0">
            <span
              className={`block w-full truncate font-normal ${
                food.isPacked
                  ? 'text-gray-500 line-through print:text-gray-900 print:no-underline'
                  : 'text-gray-900'
              }`}
            >
              {food.name}
            </span>
          </div>
          {/* Description column slot, kept for skeleton alignment with gear
              rows at lg+; food has no description. */}
          <div className="hidden lg:block lg:flex-[3] min-w-0" />
        </div>
      </label>
      {/* Worn slot stays empty (food is never worn); the consumable slot is
          always lit - food is consumable by definition, which is exactly why
          its grams already count toward consumable weight. */}
      <span className="shrink-0 w-6 inline-flex items-center justify-center" />
      <span className="shrink-0 w-6 inline-flex items-center justify-center">
        <ConsumableIcon />
      </span>
      <span className={`shrink-0 w-10 text-right ${FLAT_TABLE_QUANTITY_TEXT} text-gray-500`}>
        {food.unitCount}
      </span>
      {/* Same component and the same layout utilities as the gear pack row:
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
        className="hidden lg:inline-block shrink-0 w-24 text-gray-500 print:hidden"
      />
      {rowAction}
    </div>
  )
}
