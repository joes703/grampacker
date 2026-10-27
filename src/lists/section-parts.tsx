import type { ReactNode } from 'react'
// Type-only: erases at build time, so the share view's bundle is unaffected.
import type { FoodItemResponse } from '../../shared/food'
import type { ListItemWithGear } from '../lib/types'
import type { GearStatus } from '../lib/gear-status'
import type { ListItemPatch } from '../lib/queries'
import type { WeightUnit } from '../lib/weight'
import { FLAT_TABLE_HEADER } from '../components/flat-table-styles'
import type { ItemRowProps } from './ItemRow'

// What CategoryTable (List view and the public share) and PackSection (every
// Pack section) share: the row-handler props, the per-row props builder, the
// drag seam's type, and the header frame.
//
// This module, CategoryTable and PackSection must NOT import @dnd-kit, by
// value, ever. CategoryTable renders on the public share view, and a
// read-only page has no business downloading a drag-and-drop library. That is
// why drag arrives as the `renderRows` prop: see SortableCategoryRows.tsx.

// The props a row needs, minus the three the sortable wrapper supplies itself.
type RowProps = Omit<ItemRowProps, 'dragHandle' | 'outerRef' | 'outerStyle'>

/** Props for one pack-mode food row - built by PackSection (plain data and
 *  handlers, no @dnd-kit) and rendered by the injected renderRows, which wraps
 *  them in SortableFoodRow on the authenticated side. */
type PackFoodRowProps = {
  food: FoodItemResponse
  reorderPending: boolean
  // Required: a food row without the unit would format grams against a
  // different scale than the gear row beside it in the same bag.
  weightUnit: WeightUnit
  onUpdate: (patch: { isPacked?: boolean; isReady?: boolean }) => void
  rowAction?: ReactNode
}

/** The DRAG rendering for a section's rows, injected rather than switched on
 *  a `sortable` boolean: a boolean cannot hide an import from the bundler,
 *  and a prop can. Absent (the share view) means plain, non-draggable rows. */
export type RenderRows = (
  items: ListItemWithGear[],
  rowPropsFor: (item: ListItemWithGear) => RowProps,
  /** Pack only: this section's food rows plus their per-row props builder.
   *  The injected renderer merges them with the gear rows into union display
   *  order. */
  packFood?: {
    rows: FoodItemResponse[]
    rowPropsFor: (food: FoodItemResponse) => PackFoodRowProps
  },
) => ReactNode

// The row editing handlers. Each receives the id it acts on, so the page can
// pass one stable handler to every section instead of per-section arrows
// (fresh closures would defeat the sections' React.memo). Deleting from
// inventory is deliberately not among them (ItemRow's RowKebab says why).
type RowHandlers = {
  onUpdate?: (itemId: string, patch: ListItemPatch) => void
  onDelete?: (itemId: string) => void
  onSaveGearName?: (gearItemId: string, name: string) => void
  onSaveGearDescription?: (gearItemId: string, description: string) => void
  onSaveGearWeight?: (gearItemId: string, weightGrams: number) => void
  onEditGearItem?: (gearItemId: string) => void
  onSetGearStatus?: (gearItemId: string, status: GearStatus) => void
}

/** The props a page hands every section alike. Keep every value stable (the
 *  sections are memoized): the page builds this object once per change of its
 *  inputs, not per render. */
export type SharedSectionProps = RowHandlers & {
  weightUnit: WeightUnit
  // Page-level breakpoint (<1024 px, Tailwind's `lg:`), drilled down so a
  // long list registers one matchMedia subscription instead of one per row.
  isBelowLg: boolean
  renderRows?: RenderRows
}

/** Pack sections also take the pack filters and the food-row write. */
export type SharedPackSectionProps = SharedSectionProps & {
  /** Hide already-packed / already-ready rows. A row renders only if it
   *  passes BOTH: "what's left to pack" and "what's left to prep" are
   *  different questions. Header counts still reflect every row. */
  showUnpackedOnly?: boolean
  showUnreadyOnly?: boolean
  onUpdateFood?: (foodId: string, patch: { isPacked?: boolean; isReady?: boolean }) => void
}

// The same per-row props for SortableItemRow and ItemRow. reorderPending is
// read by SortableItemRow's useSortable (`disabled`); a plain row ignores it.
export function buildRowProps(
  item: ListItemWithGear,
  section: RowHandlers & {
    weightUnit: WeightUnit
    isBelowLg: boolean
    packMode: boolean
    reorderPending: boolean
    rowAction?: ReactNode
  },
): RowProps {
  const gearId = item.gearItem.id
  const {
    onUpdate,
    onDelete,
    onSaveGearName,
    onSaveGearDescription,
    onSaveGearWeight,
    onEditGearItem,
    onSetGearStatus,
  } = section
  return {
    item,
    weightUnit: section.weightUnit,
    isBelowLg: section.isBelowLg,
    packMode: section.packMode,
    reorderPending: section.reorderPending,
    onUpdate: onUpdate ? (patch) => onUpdate(item.id, patch) : undefined,
    onSaveName: onSaveGearName ? (n) => onSaveGearName(gearId, n) : undefined,
    onSaveDescription: onSaveGearDescription ? (d) => onSaveGearDescription(gearId, d) : undefined,
    onSaveWeight: onSaveGearWeight ? (w) => onSaveGearWeight(gearId, w) : undefined,
    onEditGearItem: onEditGearItem ? () => onEditGearItem(gearId) : undefined,
    onSetGearStatus: onSetGearStatus ? (s) => onSetGearStatus(gearId, s) : undefined,
    onDelete: onDelete ? () => onDelete(item.id) : undefined,
    rowAction: section.rowAction,
  }
}

// The header strip of every section card. It is also the column header for
// the rows below, so each section type fills it with its own column stubs.
// Height comes from FLAT_TABLE_HEADER (the mobile touch floor and the desktop
// scanline), so a density retune flows through the token.
export function SectionHeader({
  spacing,
  collapsed = false,
  children,
}: {
  // Gaps and padding: these must match the section's rows, or the column
  // labels drift off the cells below them.
  spacing: string
  collapsed?: boolean
  children: ReactNode
}) {
  // Collapsed: the header is the card's only child, so its divider border-b
  // would double with the card's bottom border.
  return (
    <div className={`${FLAT_TABLE_HEADER} ${spacing} ${collapsed ? 'border-b-0' : ''}`}>
      {children}
    </div>
  )
}
