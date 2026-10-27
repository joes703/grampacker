import { memo, type ReactNode } from 'react'
import { Check } from 'lucide-react'
import type { FoodItemResponse } from '../../shared/food'
import type { ListItemWithGear } from '../lib/types'
import {
  COL_ICON,
  COL_QTY,
  COL_WEIGHT,
  FLAT_TABLE_EYEBROW,
  FLAT_TABLE_HEADER_TITLE,
  FLAT_TABLE_HEADER_TITLE_MUTED,
  FLAT_TABLE_NUMERIC_TEXT,
  FLAT_TABLE_SURFACE,
  PRINT_UNTRUNCATE,
  ROW_CONTROL_TARGET,
} from '../components/flat-table-styles'
import ItemRow from './ItemRow'
import { isOrdinarySectionRow, passesPackFilters } from './section-rows'
import { PackChecks } from './PackRowFrame'
import { ConsumableIcon, WornIcon } from './list-item-flags'
import { buildRowProps, SectionHeader, type SharedPackSectionProps } from './section-parts'

// One Pack section as a checklist: a packing location, Unassigned, a category
// while the list has no locations yet, the food fallback, or the Worn pile.
// The header counts packed rows and marks the section complete; it has no
// collapse control (a chevron would occupy the rows' leading column and push
// the header's checkboxes off the ones they label) and no weight footer.
//
// Like CategoryTable, no @dnd-kit import: drag rendering, the drag grip and
// the admin menus arrive as props, from PackLocationSection and the page.

type Props = SharedPackSectionProps & {
  name: string
  items: ListItemWithGear[]
  /** The copy for a section with nothing in it. Defaults to the location
   *  wording; a category says so, and an empty Unassigned is success. */
  emptyLabel?: string
  /** The gear item backing an item-backed packing location. It becomes the
   *  header's checklist row instead of also rendering as an ordinary row. */
  containerItem?: ListItemWithGear | null
  reorderPending?: boolean
  /** Header chrome, injected because it needs @dnd-kit or authenticated-only
   *  components. headerLeading sits first (the drag grip). headerAction sits
   *  in the rows' menu column, so it must be exactly one row control wide.
   *  titleAction is any other control (the nest handle): it sits at the end
   *  of the flex-1 title region, where its width costs the Qty column
   *  nothing. */
  headerLeading?: ReactNode
  headerAction?: ReactNode
  titleAction?: ReactNode
  /** Replaces the title text (rename in place). `name` still supplies the
   *  accessible labels. Anything with width belongs here, not in
   *  headerAction, which would shift the column labels off their cells. */
  titleContent?: ReactNode
  /** Per-row trailing control: the move menu, or Edit and Remove on Worn. */
  renderRowAction?: (item: ListItemWithGear) => ReactNode
  /** This section's food rows. Filtered and counted like gear, and handed to
   *  renderRows for union-ordered rendering. */
  packFoodRows?: FoodItemResponse[]
  renderFoodRowAction?: (food: FoodItemResponse) => ReactNode
  /** The one section that renders worn rows; every other pack section leaves
   *  them out (section-rows.ts owns the rule; the reorder planner uses it
   *  too). */
  wornSection?: boolean
} & (
  // Nested bags render as children. When present, the complete checklist
  // membership is required too: the header must count everything inside it.
  | { children?: undefined; packProgressItems?: never }
  | { children: ReactNode; packProgressItems: ListItemWithGear[] }
)

function PackSection({
  name,
  items,
  emptyLabel = 'No items in this location.',
  containerItem,
  children,
  packProgressItems,
  weightUnit,
  isBelowLg,
  renderRows,
  reorderPending = false,
  showUnpackedOnly = false,
  showUnreadyOnly = false,
  headerLeading,
  headerAction,
  titleAction,
  titleContent,
  renderRowAction,
  packFoodRows,
  onUpdateFood,
  renderFoodRowAction,
  wornSection = false,
  ...handlers
}: Props) {
  const sectionItems = wornSection ? items : items.filter((item) => isOrdinarySectionRow(item, true))
  // Header counts and "complete" read the FULL membership, never the filtered
  // rows; food counts like gear.
  const progressItems = packProgressItems
    ?? (containerItem ? [containerItem, ...sectionItems] : sectionItems)
  const sectionFood = packFoodRows ?? []
  const packedCount =
    progressItems.filter((i) => i.isPacked).length + sectionFood.filter((f) => f.isPacked).length
  const progressTotal = progressItems.length + sectionFood.length
  const complete = progressTotal > 0 && packedCount === progressTotal
  // The filters are ANDed: with both on you see only rows with everything
  // still to do. OR would make a second filter show MORE rows.
  const filters = { showUnpackedOnly, showUnreadyOnly }
  const filtering = showUnpackedOnly || showUnreadyOnly
  const visibleItems = filtering ? sectionItems.filter((i) => passesPackFilters(i, filters)) : sectionItems
  const visibleFood = filtering ? sectionFood.filter((f) => passesPackFilters(f, filters)) : sectionFood
  const memberCount = sectionItems.length + sectionFood.length

  const rowPropsFor = (item: ListItemWithGear) =>
    buildRowProps(item, {
      ...handlers,
      weightUnit,
      isBelowLg,
      packMode: true,
      reorderPending,
      rowAction: renderRowAction?.(item),
    })

  return (
    <div className={FLAT_TABLE_SURFACE}>
      {/* The gaps are PackRowFrame's (gap-2 lg:gap-2.5 print:gap-1): every
          trailing column adds one gap, so a narrower header gap walks the Qty
          label off the row quantities one gap per column. Mobile tightens
          the padding to px-2, since the extra column slots squeeze the
          header. */}
      <SectionHeader spacing="gap-2 lg:gap-2.5 print:gap-1 px-2 lg:px-3 print:px-1 py-0">
        {headerLeading}
        <div className="flex flex-1 min-w-0 items-center gap-2 lg:gap-2.5 print:gap-1">
          {containerItem ? (
            <PackChecks
              name={containerItem.gearItem.name}
              isPacked={containerItem.isPacked}
              isReady={containerItem.isReady}
              onUpdate={(patch) => handlers.onUpdate?.(containerItem.id, patch)}
            >
              <span className={`truncate ${PRINT_UNTRUNCATE} ${
                containerItem.isPacked
                  ? `${FLAT_TABLE_HEADER_TITLE_MUTED} line-through print:text-gray-900 print:no-underline`
                  : FLAT_TABLE_HEADER_TITLE
              }`}>
                {containerItem.gearItem.name}
              </span>
            </PackChecks>
          ) : (
            titleContent ?? (
              <span className={`truncate ${PRINT_UNTRUNCATE} ${complete ? FLAT_TABLE_HEADER_TITLE_MUTED : FLAT_TABLE_HEADER_TITLE}`}>{name}</span>
            )
          )}
          {complete && (
            <Check size={14} className="shrink-0 text-green-600 print:hidden" aria-label="All packed" />
          )}
          {titleAction && <span className="ml-auto flex shrink-0 items-center">{titleAction}</span>}
        </div>
        {containerItem ? (
          <>
            <span className={`${COL_ICON} inline-flex items-center justify-center`}>
              {containerItem.isWorn && <WornIcon />}
            </span>
            <span className={`${COL_ICON} inline-flex items-center justify-center`}>
              {containerItem.isConsumable && <ConsumableIcon />}
            </span>
            <span className={`${COL_QTY} text-center ${FLAT_TABLE_NUMERIC_TEXT} text-gray-500`}>
              {containerItem.quantity}
            </span>
            <div className={`hidden lg:block ${COL_WEIGHT} print:hidden`} />
          </>
        ) : (
          <>
            <div className={COL_ICON} />
            <div className={COL_ICON} />
            <div className={`${COL_QTY} text-center ${FLAT_TABLE_EYEBROW}`}>Qty</div>
            <div className={`hidden lg:block ${COL_WEIGHT} text-right ${FLAT_TABLE_EYEBROW} print:hidden`}>
              Weight
            </div>
          </>
        )}
        {/* A pack row ends with its row controls: one menu button, or Edit
            and Remove in the Worn section. The header ends with the same
            columns or its Qty label sits over the row's Weight. A section
            with its own menu fills the slot; otherwise empty stand-ins do.
            Print hides row controls, so the stand-ins hide there too. */}
        {headerAction ?? Array.from({ length: wornSection ? 2 : 1 }, (_, i) => (
          <span key={i} aria-hidden="true" className={`shrink-0 ${ROW_CONTROL_TARGET} print:hidden`} />
        ))}
      </SectionHeader>

      <div>
        {renderRows
          ? renderRows(
              visibleItems,
              rowPropsFor,
              packFoodRows !== undefined
                ? {
                    rows: visibleFood,
                    rowPropsFor: (food) => ({
                      food,
                      reorderPending,
                      weightUnit,
                      onUpdate: (patch) => onUpdateFood?.(food.id, patch),
                      rowAction: renderFoodRowAction?.(food),
                    }),
                  }
                : undefined,
            )
          : visibleItems.map((item) => <ItemRow key={item.id} {...rowPropsFor(item)} />)}
        {/* An empty section says WHY. Otherwise "holds nothing" and "a filter
            hides everything" look the same, and a packer scanning for what is
            left could read a filtered-empty section as done. */}
        {visibleItems.length + visibleFood.length === 0 && !children && (
          <p className="px-3 py-3 text-sm text-gray-500 print:px-1 print:py-0.5 print:text-[10px]">
            {memberCount === 0
              ? emptyLabel
              : `All ${memberCount} ${memberCount === 1 ? 'item' : 'items'} here are hidden by the filters above.`}
          </p>
        )}
        {children}
      </div>
    </div>
  )
}

export default memo(PackSection)
