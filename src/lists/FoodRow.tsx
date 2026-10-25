import type { FoodItemResponse } from '../../shared/food'
import type { WeightUnit } from '../lib/weight'
import ItemWeightValue from '../components/ItemWeightValue'
import {
  COL_ICON,
  COL_QTY_EDIT,
  COL_QTY_MOBILE,
  COL_WEIGHT,
  COL_WEIGHT_MOBILE,
  FLAT_TABLE_NUMERIC_TEXT,
  FLAT_TABLE_QUANTITY_TEXT,
  ROW_LEADING_CONTROL_TARGET,
  itemRowShell,
} from '../components/flat-table-styles'
import { MobileRowBody, NameDescriptionCell } from '../components/ItemRowScaffold'
import { ConsumableIcon } from './list-item-flags'

// A food row in the CATEGORY arrangement and on the public share - the two
// places food is read rather than packed. SortableFoodRow is its Pack-mode
// counterpart; the two exist separately because they answer to different
// skeletons, not because food behaves differently in each. Pack rows carry
// checkboxes and a drag handle and align against the pack header; these align
// against the ordinary category header (worn / consumable / qty / weight),
// through the same shell and cells ItemRow composes, so the two row kinds
// cannot drift apart.
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
  /** Reserve the control columns the gear rows around this table carry:
   *  the leading drag-grip box (both tiers) and the trailing kebab box
   *  (desktop; mobile gear rows have no kebab). Set through CategoryGroup's
   *  reserveControlColumns on the owner's page. The share page leaves it
   *  unset - its gear rows are read-only too, with neither control.
   *  print:hidden like the controls themselves, which vanish on paper. */
  controlColumns?: boolean
}

export default function FoodRow({
  food,
  weightUnit,
  isBelowLg = false,
  controlColumns = false,
}: Props) {
  return (
    <div className={itemRowShell(false)}>
      {controlColumns && (
        /* The drag grip's exact box (RowIconButton's dragHandle sizing).
           Mobile gear rows put the grip OUTSIDE their px-3 foreground while
           this shell's padding wraps everything, so -mr-1.5 gives back the
           shell's gap and lands the name on the gear rows' name rail; at lg
           the grip sits inside the padding like this one and the gap is
           wanted, so the margin resets. */
        <span
          className={`shrink-0 ${ROW_LEADING_CONTROL_TARGET} -mr-1.5 lg:mr-0 print:hidden`}
        />
      )}
      {isBelowLg ? (
        <div className="flex flex-1 min-w-0 items-center gap-2">
          {/* status 'active' renders no badge; food has no gear status. */}
          <MobileRowBody status="active" name={food.name}>
            {/* The single worn/consumable slot mobile gear rows carry. Food
                is consumable by definition - which is exactly why its grams
                land in consumable weight rather than base weight. */}
            <span className={`${COL_ICON} inline-flex items-center justify-center`}>
              <ConsumableIcon />
            </span>
            <span className={`${COL_QTY_MOBILE} text-center ${FLAT_TABLE_QUANTITY_TEXT} text-gray-600`}>
              {food.unitCount}
            </span>
            <span className={`${COL_WEIGHT_MOBILE} text-right ${FLAT_TABLE_NUMERIC_TEXT} text-gray-600`}>
              <ItemWeightValue grams={food.weightGrams} unit={weightUnit} />
            </span>
          </MobileRowBody>
        </div>
      ) : (
        <>
          {/* Name occupies the name column; the description column stays
              empty because food has no description. Both are rendered so the
              columns to the right land where the header says they will. */}
          <NameDescriptionCell status="active" name={food.name} description="" />
          {/* Worn slot stays empty - food is never worn. */}
          <span className={`${COL_ICON} inline-flex items-center justify-center`} />
          <span className={`${COL_ICON} inline-flex items-center justify-center`}>
            <ConsumableIcon />
          </span>
          <span className={`${COL_QTY_EDIT} text-center ${FLAT_TABLE_QUANTITY_TEXT} text-gray-600`}>
            {food.unitCount}
          </span>
          <span className={`${COL_WEIGHT} text-right ${FLAT_TABLE_NUMERIC_TEXT} text-gray-600`}>
            <ItemWeightValue grams={food.weightGrams} unit={weightUnit} />
          </span>
          {controlColumns && <span className={`${COL_ICON} print:hidden`} />}
        </>
      )}
    </div>
  )
}
