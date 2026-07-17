import ItemWeightValue from '../components/ItemWeightValue'
import {
  FLAT_TABLE_BODY_TEXT,
  FLAT_TABLE_HEADER,
  FLAT_TABLE_HEADER_COUNT,
  FLAT_TABLE_HEADER_PADDING,
  FLAT_TABLE_HEADER_TITLE,
  FLAT_TABLE_META_TEXT,
  FLAT_TABLE_ROW,
} from '../components/flat-table-styles'
import type { WeightUnit } from '../lib/weight'
import type { FoodPackRow } from '../food/pack-rows'
import PackModeCheckbox from './PackModeCheckbox'

type Props = {
  rows: FoodPackRow[]
  weightUnit: WeightUnit
  showUnpackedOnly: boolean
  onToggle: (foodItemId: string, packed: boolean) => void
}

// Pack mode's expansion of the derived Food row (food-planning-design.md 8,
// slice 4): one checkbox per DISTINCT food in the plan, because pack state
// is keyed (list_id, food_item_id) - you pack "the ramen", not a cell.
//
// Every checkbox is enabled - nothing blocks packing (decided 2026-07-17).
// A food the library cache cannot name yet renders under a fallback label,
// and an Estimate row's weight is an undercount, but both are still food
// you physically put in the bag.
export default function FoodPackSection({
  rows,
  weightUnit,
  showUnpackedOnly,
  onToggle,
}: Props) {
  const visible = showUnpackedOnly ? rows.filter((r) => !r.packed) : rows
  if (visible.length === 0) return null

  return (
    <section aria-labelledby="food-pack-heading" className="mt-4">
      <div className={`${FLAT_TABLE_HEADER} ${FLAT_TABLE_HEADER_PADDING}`}>
        <h3 id="food-pack-heading" className={FLAT_TABLE_HEADER_TITLE}>
          Food
        </h3>
        <span className={`ml-2 ${FLAT_TABLE_HEADER_COUNT}`}>
          {rows.length} food{rows.length === 1 ? '' : 's'}
        </span>
      </div>

      {visible.map((row) => {
        const name = row.name ?? 'Unknown food'
        return (
          <div
            key={row.foodItemId}
            className={`${FLAT_TABLE_ROW} flex items-center gap-2`}
          >
            <PackModeCheckbox
              variant="packed"
              checked={row.packed}
              onChange={(checked) => onToggle(row.foodItemId, checked)}
              ariaLabel={`Pack ${name}`}
              standaloneLabel
            />
            <span className="flex-1 min-w-0">
              <span className={`block truncate ${FLAT_TABLE_BODY_TEXT} text-gray-900`}>
                {name}
              </span>
              {(row.brand !== null || row.estimate) && (
                <span className={`block truncate ${FLAT_TABLE_META_TEXT}`}>
                  {row.brand}
                  {/* Same generic wording as the Food row and the editor's
                      badge (see FoodRow.tsx for why the cause stays
                      unnamed). */}
                  {row.brand !== null && row.estimate && ' · '}
                  {row.estimate && 'Estimate'}
                </span>
              )}
            </span>
            <ItemWeightValue grams={row.grams} unit={weightUnit} />
          </div>
        )
      })}
    </section>
  )
}
