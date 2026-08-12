import type { FoodItemResponse } from '../../shared/food'
import type { WeightUnit } from '../lib/weight'
import ItemWeightValue from '../components/ItemWeightValue'
import {
  FLAT_TABLE_BODY_TEXT,
  FLAT_TABLE_NUMERIC_TEXT,
  FLAT_TABLE_QUANTITY_TEXT,
  FLAT_TABLE_ROW,
} from '../components/flat-table-styles'
import { ConsumableIcon } from './list-item-flags'

// A food row in the CATEGORY arrangement and on the public share - the two
// places food is read rather than packed. SortableFoodRow is its Pack-mode
// counterpart; the two exist separately because they answer to different
// skeletons, not because food behaves differently in each. Pack rows carry
// checkboxes and a drag handle and align against the pack header; these align
// against the ordinary category header (worn / consumable / qty / weight).
//
// Read-only, and that is a property of the SURFACE rather than a limitation.
// A food item is authored in the Food view, where its schedule lives; a row
// here that could rename or reweigh it would be a second authoring path for
// data whose first one is a page away. On the owner's page the section header
// carries the link out to it; on the public share there is nothing to link to
// and the rows are simply the document.
//
// No @dnd-kit import, deliberately: this module renders on the anonymous
// share page. The same bundling seam CategoryGroup maintains with its
// renderRows prop would be pointless if the plain food row dragged in the
// drag machinery by itself.
type Props = {
  food: Pick<FoodItemResponse, 'id' | 'name' | 'unitCount' | 'weightGrams'>
  weightUnit: WeightUnit
  /** Page-level breakpoint, drilled from the section rather than subscribed
   *  per row - same reason ItemRow takes it. */
  isBelowLg?: boolean
}

export default function FoodRow({ food, weightUnit, isBelowLg = false }: Props) {
  return (
    <div
      // Matches ItemRow's non-pack row exactly, including the px-3 mobile
      // inset it takes instead of the canonical padding ramp. A food row and
      // a gear row sit in the same stack of sections on one page; a different
      // inset on one of them reads as a rendering bug.
      className={`group relative ${FLAT_TABLE_ROW} ${FLAT_TABLE_BODY_TEXT} gap-1.5 bg-white px-3 py-2 lg:py-0`}
    >
      {isBelowLg ? (
        <div className="flex flex-1 items-center gap-2">
          <span className="block min-w-0 flex-1 truncate font-normal text-gray-900">
            {food.name}
          </span>
          {/* The single worn/consumable slot mobile gear rows carry. Food is
              consumable by definition - which is exactly why its grams land
              in consumable weight rather than base weight. */}
          <span className="shrink-0 w-6 inline-flex items-center justify-center">
            <ConsumableIcon />
          </span>
          <span className={`shrink-0 w-8 text-right ${FLAT_TABLE_QUANTITY_TEXT} text-gray-600`}>
            {food.unitCount}
          </span>
          <span className={`shrink-0 w-20 text-right ${FLAT_TABLE_NUMERIC_TEXT} text-gray-600`}>
            <ItemWeightValue grams={food.weightGrams} unit={weightUnit} />
          </span>
        </div>
      ) : (
        <>
          {/* Name occupies the name column; the description column stays empty
              because food has no description. Both are rendered so the columns
              to the right land where the header says they will. */}
          <div className="flex-1 min-w-0 flex items-center gap-3">
            <div className="flex-[2] min-w-0 flex items-center gap-1.5">
              <span className="block min-w-0 flex-1 truncate font-normal text-gray-900">
                {food.name}
              </span>
            </div>
            <div className="flex-[3] min-w-0" />
          </div>
          {/* Worn slot stays empty - food is never worn. */}
          <span className="shrink-0 w-6 inline-flex items-center justify-center" />
          <span className="shrink-0 w-6 inline-flex items-center justify-center">
            <ConsumableIcon />
          </span>
          <span className={`shrink-0 w-12 text-right ${FLAT_TABLE_QUANTITY_TEXT} text-gray-600`}>
            {food.unitCount}
          </span>
          <span className={`shrink-0 w-24 text-right ${FLAT_TABLE_NUMERIC_TEXT} text-gray-600`}>
            <ItemWeightValue grams={food.weightGrams} unit={weightUnit} />
          </span>
        </>
      )}
    </div>
  )
}
