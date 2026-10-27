import { memo, useState } from 'react'
import { ChevronDown, ChevronRight, Plus } from 'lucide-react'
import type { ListItemWithGear } from '../lib/types'
import type { WeightUnit } from '../lib/weight'
import { useIsPrinting } from '../lib/use-is-printing'
import {
  COL_ICON,
  COL_QTY_EDIT,
  COL_QTY_MOBILE,
  COL_WEIGHT,
  COL_WEIGHT_MOBILE,
  FLAT_TABLE_EYEBROW,
  FLAT_TABLE_FOOTER_LABEL,
  FLAT_TABLE_FOOTER_ROW,
  FLAT_TABLE_FOOTER_VALUE,
  FLAT_TABLE_HEADER_PADDING,
  FLAT_TABLE_HEADER_TITLE,
  FLAT_TABLE_SURFACE,
  PRINT_UNTRUNCATE,
  ROW_LEADING_CONTROL_TARGET,
} from '../components/flat-table-styles'
import TotalWeightValue from '../components/TotalWeightValue'
import ItemRow from './ItemRow'
import FoodRow from './FoodRow'
import AddItemRow from './AddItemRow'
import { type AddItemData } from './use-quick-add-form'
import { buildRowProps, SectionHeader, type SharedSectionProps } from './section-parts'

// One category as a weight table: the List view's sections and the public
// share's. Pack sections are PackSection. Column widths (header stubs, row
// cells, footer) come from the flat-table tokens, so labels, rows and totals
// line up.
//
// Categories are not reorderable here (category order is authored on /gear).
// Items reorder within their category through the SortableContext that
// renderRows supplies; the share view passes no renderRows and gets plain
// rows.
//
// Editing affordances are gated on which handlers are passed: renderRows for
// drag, onAddItem for the "+ Add new item" footer and draft row, and the row
// handlers for each row's editing controls.

/** What a read-only food row needs, and nothing more. Structural rather than
 *  a Pick of FoodItemResponse so the public share - whose DTO carries no
 *  packing state - can satisfy it. */
type PlainFoodRow = {
  id: string
  name: string
  // What you CARRY: per-meal items multiply their quantity by the meals they
  // are scheduled into, so the pack list says five packets when you carry five.
  unitCount: number
  weightGrams: number
}

type Props = SharedSectionProps & {
  name: string
  items: ListItemWithGear[]
  /** False on the public share: no chevron, no region id. */
  collapsible?: boolean
  /** A string is a real category; null is Uncategorized. Also the category
   *  the add-item row files new items under. */
  categoryId?: string | null
  /** The region id for a section with no category of its own (Food). Without
   *  it the section derives the same id as the real Uncategorized section,
   *  and two chevrons point aria-controls at one duplicated id. */
  regionKey?: string
  reorderPending?: boolean
  /** Read-only food rows, rendered after this section's gear rows. */
  foodRows?: PlainFoodRow[]
  /** Reserve the empty drag-grip and kebab boxes on rows that have neither,
   *  so the Food section's cells and footer sit on the gear tables' rails.
   *  The share leaves it unset: no row there has a grip or a kebab. */
  reserveControlColumns?: boolean
  /** Footer totals, supplied by the parent from computeListWeightBreakdown so
   *  there is one definition of each weight bucket; never summed here. Passed
   *  as primitives, not objects, so the memo's shallow compare holds. Zero
   *  buckets are omitted. */
  baseSubtotalGrams?: number
  consumableSubtotalGrams?: number
  wornSubtotalGrams?: number
  // Takes the categoryId so the parent can pass one stable handler to every
  // section. null = Uncategorized.
  onAddItem?: (categoryId: string | null, data: AddItemData) => void
  /** Open with the add-item row already showing: set on a category the user
   *  just created from the list page. Initial state only. */
  startAdding?: boolean
}

// Wrapped in React.memo at the export. The memo only pays off with stable
// props at the call site: `items` from useGroupedListItems keeps its
// reference across writes that did not change the section, and the shared
// props are one memoized object.
function CategoryTable({
  name,
  items,
  weightUnit,
  isBelowLg,
  collapsible = true,
  categoryId,
  regionKey,
  renderRows,
  reorderPending = false,
  foodRows,
  reserveControlColumns = false,
  baseSubtotalGrams,
  consumableSubtotalGrams,
  wornSubtotalGrams,
  onAddItem,
  startAdding = false,
  ...handlers
}: Props) {
  // The desktop inline add row. Mobile adds through the gear picker drawer.
  const [adding, setAdding] = useState(startAdding)
  const [localCollapsed, setLocalCollapsed] = useState(false)
  // A collapsed section removes its body from the DOM, so no print stylesheet
  // can bring those rows back and the printed sheet would be short of gear.
  // Overriding the DERIVED value leaves the stored state as the user left it.
  const isPrinting = useIsPrinting()
  const collapsed = isPrinting ? false : localCollapsed
  const regionId = `cat-region-${regionKey ?? categoryId ?? 'uncategorized'}`
  const showKebabSlot = Boolean(handlers.onDelete) || reserveControlColumns

  const rowPropsFor = (item: ListItemWithGear) =>
    buildRowProps(item, { ...handlers, weightUnit, isBelowLg, packMode: false, reorderPending })

  const footerWeights = (
    <CategoryFooterWeights
      baseGrams={baseSubtotalGrams}
      consumableGrams={consumableSubtotalGrams}
      wornGrams={wornSubtotalGrams}
      weightUnit={weightUnit}
    />
  )

  return (
    <div className={FLAT_TABLE_SURFACE}>
      <SectionHeader spacing={`gap-1.5 print:gap-1 ${FLAT_TABLE_HEADER_PADDING}`} collapsed={collapsed}>
        {collapsible ? (
          <div className="flex flex-1 min-w-0 items-center gap-1.5 print:gap-1">
            {/* The chevron is the only collapse target. When the whole header
                strip was one button, a mobile tap near the first row often
                collapsed the section. The title is static text. */}
            <button
              type="button"
              onClick={() => setLocalCollapsed(!collapsed)}
              aria-expanded={!collapsed}
              aria-controls={regionId}
              aria-label={collapsed ? `Expand ${name}` : `Collapse ${name}`}
              className={`${ROW_LEADING_CONTROL_TARGET} text-gray-500 hover:text-gray-800 hover:bg-gray-200/60 shrink-0 print:hidden`}
            >
              {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
            </button>
            <span className={`truncate ${PRINT_UNTRUNCATE} ${FLAT_TABLE_HEADER_TITLE}`}>{name}</span>
          </div>
        ) : (
          <span className={`flex-1 min-w-0 truncate ${FLAT_TABLE_HEADER_TITLE}`}>{name}</span>
        )}
        {/* Desktop column stubs (lg+): worn, consumable, qty, weight, kebab. */}
        <div className="hidden lg:contents">
          <div className={COL_ICON} />
          <div className={COL_ICON} />
          <div className={`${COL_QTY_EDIT} text-center ${FLAT_TABLE_EYEBROW}`}>Qty</div>
          <div className={`${COL_WEIGHT} text-right ${FLAT_TABLE_EYEBROW}`}>Weight</div>
          {showKebabSlot && <div className={COL_ICON} />}
        </div>
        {/* Mobile column stubs: one flag slot and narrower qty and weight
            columns, matching the mobile row. No kebab stub. */}
        <div className="lg:hidden flex items-center gap-2">
          <div className={COL_ICON} />
          <div className={`${COL_QTY_MOBILE} text-center ${FLAT_TABLE_EYEBROW}`}>Qty</div>
          <div className={`${COL_WEIGHT_MOBILE} text-right ${FLAT_TABLE_EYEBROW}`}>Weight</div>
        </div>
      </SectionHeader>

      {!collapsed && (
        // The id exists only as the chevron's aria-controls target, so it is
        // emitted only with the chevron.
        <div id={collapsible ? regionId : undefined}>
          {renderRows
            ? renderRows(items, rowPropsFor)
            : items.map((item) => <ItemRow key={item.id} {...rowPropsFor(item)} />)}
          {foodRows?.map((food) => (
            <FoodRow
              key={food.id}
              food={food}
              weightUnit={weightUnit}
              isBelowLg={isBelowLg}
              controlColumns={reserveControlColumns}
            />
          ))}

          {onAddItem && adding && (
            <AddItemRow
              onSubmit={(data) => { onAddItem(categoryId ?? null, data); setAdding(false) }}
              onCancel={() => setAdding(false)}
            />
          )}

          {/* Footer: "+ Add new item" on the left at lg+, the category totals
              on the right under Weight. Hidden on mobile, where it would
              break the flat table rhythm and the summary strip carries the
              totals; kept for print, where the per-category total belongs on
              the paper checklist. The whole row uses the footer's text-xs
              tier. */}
          {!adding && (
            <div className={`hidden lg:flex print:flex gap-1.5 ${FLAT_TABLE_FOOTER_ROW}`}>
              {onAddItem ? (
                // print:hidden like every interactive control; the spacer
                // below takes over the flex-1 slot on paper.
                <button
                  onClick={() => setAdding(true)}
                  className={`hidden lg:flex print:hidden flex-1 min-w-0 items-center gap-1 text-left ${FLAT_TABLE_FOOTER_LABEL} hover:text-blue-600`}
                >
                  <Plus size={12} /> Add new item
                </button>
              ) : null}
              <div className={`flex-1 min-w-0 ${onAddItem ? 'lg:hidden print:block' : ''}`} />
              {/* Compound lb+oz values extend left into the empty Qty rail,
                  keeping the right edge on the Weight column. */}
              <div className="hidden lg:contents">
                <div className={COL_ICON} />
                <div className={COL_ICON} />
                <div className="shrink-0 min-w-[9.375rem] text-right text-gray-700">{footerWeights}</div>
                {showKebabSlot && <div className={COL_ICON} />}
              </div>
              <div className="lg:hidden flex items-center gap-2">
                <div className={COL_ICON} />
                <div className="shrink-0 min-w-[7.5rem] text-right text-gray-700">{footerWeights}</div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function CategoryFooterWeights({
  baseGrams,
  consumableGrams,
  wornGrams,
  weightUnit,
}: {
  baseGrams?: number
  consumableGrams?: number
  wornGrams?: number
  weightUnit: WeightUnit
}) {
  // Worn first, then Consumable, Base last: Base is the figure every footer
  // shows, so keeping it rightmost lines it up down the page with the
  // sections that have Base alone.
  const totals = [
    { label: 'Worn', grams: wornGrams },
    { label: 'Consumable', grams: consumableGrams },
    { label: 'Base', grams: baseGrams },
  ].filter((total): total is { label: string; grams: number } => (total.grams ?? 0) > 0)

  return (
    <span className="inline-flex flex-nowrap items-baseline justify-end gap-x-3">
      {totals.map((total) => (
        // The shared footer label/value pair; the stagger rationale lives on
        // the tokens in flat-table-styles.ts.
        <span key={total.label} className="whitespace-nowrap">
          <span className={FLAT_TABLE_FOOTER_LABEL}>{total.label}</span>{' '}
          <span className={FLAT_TABLE_FOOTER_VALUE}>
            {/* Display-rounded only. Ounces convert the full aggregate so
                changing units does not compound the rounding. */}
            <TotalWeightValue
              grams={weightUnit === 'g' ? Math.round(total.grams) : total.grams}
              unit={weightUnit}
            />
          </span>
        </span>
      ))}
    </span>
  )
}

export default memo(CategoryTable)
