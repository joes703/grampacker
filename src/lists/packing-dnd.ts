import { arrayMove } from '@dnd-kit/sortable'
import type { FoodItemResponse } from '../../shared/food'
import { parseDnDId } from '../lib/dnd-ids'
import type { ListItemWithGear } from '../lib/types'
import {
  assignUnionPackRankSlots,
  packRowId,
  unionPackRows,
  type UnionRankUpdates,
} from './pack-rows'

export function isPackingCollisionTarget(
  activeId: string,
  targetId: string,
  siblingLocationIdsById: ReadonlyMap<string, ReadonlySet<string>>,
): boolean {
  const active = parseDnDId(activeId)
  const target = parseDnDId(targetId)
  if (!active || !target) return false

  if (active.kind === 'packing-location') {
    return target.kind === 'packing-location'
      && siblingLocationIdsById.get(active.id)?.has(target.id) === true
  }
  if (active.kind === 'packing-item' || active.kind === 'packing-food-item') {
    return (
      target.kind === 'packing-item' ||
      target.kind === 'packing-food-item' ||
      target.kind === 'packing-location'
    )
  }
  return false
}

// ── The union planner ──────────────────────────────────────────────────────
//
// A Pack-mode cohort is the UNION of gear rows (`packing-item:` ids) and
// food rows (`packing-food-item:` ids). One drag gesture means one of two
// things - reorder within the cohort, or move to another location. The
// reorder permutes ranks across both tables, and the move may target either
// kind of row.

export type PackingRowDragPlan =
  | { kind: 'reorder'; updates: UnionRankUpdates }
  | { kind: 'move-gear'; itemId: string; locationId: string | null }
  | { kind: 'move-food'; foodItemId: string; locationId: string | null }

type ParsedPackRowId = { rowKind: 'gear' | 'food'; id: string } | null

function parsePackRowId(raw: string): ParsedPackRowId {
  const parsed = parseDnDId(raw)
  if (parsed?.kind === 'packing-item') return { rowKind: 'gear', id: parsed.id }
  if (parsed?.kind === 'packing-food-item') {
    return { rowKind: 'food', id: parsed.id }
  }
  return null
}

// Resolve a parsed row ref against the caches. Returns the row's location -
// NORMALIZED through the rendered-location set when one is supplied, the
// same lens buildPackingTree and the sections use: during an optimistic bag
// delete the cache still carries the dead bag's id while its rows render
// under Unassigned, and planning against the raw id would misclassify a
// within-Unassigned reorder as a cross-location move.
// Returns undefined when the ref names a row that is not there (stale drag).
function locateRow(
  ref: NonNullable<ParsedPackRowId>,
  items: ListItemWithGear[],
  foodItems: FoodItemResponse[],
  normalize: (locationId: string | null) => string | null,
): { locationId: string | null } | undefined {
  const row =
    ref.rowKind === 'gear'
      ? items.find((item) => item.id === ref.id)
      : foodItems.find((item) => item.id === ref.id)
  return row ? { locationId: normalize(row.packingLocationId) } : undefined
}

function planUnionReorder(
  activeId: string,
  overId: string | undefined,
  items: ListItemWithGear[],
  foodItems: FoodItemResponse[],
  excludedItemIds: ReadonlySet<string>,
  excludedFoodIds: ReadonlySet<string>,
  normalize: (locationId: string | null) => string | null,
): UnionRankUpdates | null {
  if (overId === undefined || activeId === overId) return null
  const active = parsePackRowId(activeId)
  const over = parsePackRowId(overId)
  if (!active || !over) return null
  if (active.rowKind === 'gear' && excludedItemIds.has(active.id)) return null
  if (over.rowKind === 'gear' && excludedItemIds.has(over.id)) return null
  if (active.rowKind === 'food' && excludedFoodIds.has(active.id)) return null
  if (over.rowKind === 'food' && excludedFoodIds.has(over.id)) return null

  const activeRow = locateRow(active, items, foodItems, normalize)
  const overRow = locateRow(over, items, foodItems, normalize)
  if (!activeRow || !overRow) return null
  if (activeRow.locationId !== overRow.locationId) return null

  // This array IS one union cohort - the scope pack ranks are unique within
  // (per table) and the scope the server's index-safety check runs against.
  // Sorting by anything but union display order would compute the move
  // against a sequence the user is not looking at.
  const cohortRows = unionPackRows(
    items.filter(
      (item) =>
        normalize(item.packingLocationId) === activeRow.locationId &&
        !excludedItemIds.has(item.id),
    ),
    // Filtered food rows are excluded for the same reason filtered gear is:
    // the plan must be computed against the rows the user is looking at.
    foodItems.filter(
      (item) =>
        normalize(item.packingLocationId) === activeRow.locationId &&
        !excludedFoodIds.has(item.id),
    ),
  )
  const indexOf = (ref: NonNullable<ParsedPackRowId>) =>
    cohortRows.findIndex(
      (row) =>
        row.kind === ref.rowKind && packRowId(row) === ref.id,
    )
  const oldIndex = indexOf(active)
  const newIndex = indexOf(over)
  if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return null

  // Excluded cohort rows (worn gear, filtered rows) keep their reserved
  // ranks; the densify path must not mint one of them.
  const avoidRanks = new Set([
    ...items
      .filter(
        (item) =>
          normalize(item.packingLocationId) === activeRow.locationId &&
          excludedItemIds.has(item.id),
      )
      .map((item) => item.packSortOrder),
    ...foodItems
      .filter(
        (item) =>
          normalize(item.packingLocationId) === activeRow.locationId &&
          excludedFoodIds.has(item.id),
      )
      .map((item) => item.packSortOrder),
  ])
  return assignUnionPackRankSlots(
    arrayMove(cohortRows, oldIndex, newIndex),
    avoidRanks,
  )
}

function planUnionDrop(
  activeId: string,
  overId: string | undefined,
  items: ListItemWithGear[],
  foodItems: FoodItemResponse[],
  validLocationIds: ReadonlySet<string>,
  containerItemIdByLocation: ReadonlyMap<string, string>,
  excludedLocationIdsByItem: ReadonlyMap<string, ReadonlySet<string>>,
  normalize: (locationId: string | null) => string | null,
): PackingRowDragPlan | null {
  if (overId === undefined) return null
  const active = parsePackRowId(activeId)
  if (!active) return null
  const activeRow = locateRow(active, items, foodItems, normalize)
  if (!activeRow) return null

  const over = parseDnDId(overId)
  if (!over) return null
  let locationId: string | null
  if (over.kind === 'packing-location') {
    locationId = over.id === 'unassigned' ? null : over.id
  } else {
    const overRef = parsePackRowId(overId)
    if (!overRef) return null
    const overRow = locateRow(overRef, items, foodItems, normalize)
    if (!overRow) return null
    locationId = overRow.locationId
  }

  if (locationId !== null && !validLocationIds.has(locationId)) return null
  // Container rules are gear-only facts: food cannot back a container, so a
  // food row can never contain itself or create a nesting cycle.
  if (active.rowKind === 'gear') {
    if (
      locationId !== null &&
      containerItemIdByLocation.get(locationId) === active.id
    ) return null
    if (
      locationId !== null &&
      excludedLocationIdsByItem.get(active.id)?.has(locationId)
    ) return null
  }
  if (activeRow.locationId === locationId) return null
  return active.rowKind === 'gear'
    ? { kind: 'move-gear', itemId: active.id, locationId }
    : { kind: 'move-food', foodItemId: active.id, locationId }
}

export function planPackingRowDragEnd(
  activeId: string,
  overId: string | undefined,
  items: ListItemWithGear[],
  foodItems: FoodItemResponse[],
  validLocationIds: ReadonlySet<string>,
  containerItemIdByLocation: ReadonlyMap<string, string> = new Map(),
  excludedLocationIdsByItem: ReadonlyMap<string, ReadonlySet<string>>,
  excludedReorderItemIds: ReadonlySet<string> = new Set(),
  excludedReorderFoodIds: ReadonlySet<string> = new Set(),
  /** The location ids the page actually RENDERED. Cached assignments to any
   *  other id (an optimistically deleted bag) plan as Unassigned, matching
   *  what the user sees. Omitted (tests, callers without optimistic state):
   *  every cached id is trusted. */
  renderedLocationIds?: ReadonlySet<string>,
): PackingRowDragPlan | null {
  const normalize = (locationId: string | null) =>
    locationId === null ||
    renderedLocationIds === undefined ||
    renderedLocationIds.has(locationId)
      ? locationId
      : null
  const excludedItemIds = new Set([
    ...containerItemIdByLocation.values(),
    ...excludedReorderItemIds,
  ])
  const updates = planUnionReorder(
    activeId,
    overId,
    items,
    foodItems,
    excludedItemIds,
    excludedReorderFoodIds,
    normalize,
  )
  if (updates) return { kind: 'reorder', updates }

  return planUnionDrop(
    activeId,
    overId,
    items,
    foodItems,
    validLocationIds,
    containerItemIdByLocation,
    excludedLocationIdsByItem,
    normalize,
  )
}
