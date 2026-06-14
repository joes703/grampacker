// Public barrel for the queries domain. External consumers import from
// '@/lib/queries' (or '../lib/queries'), never from a specific submodule.
// The per-domain file layout is an internal organizational concern.
//
// Internal cross-module imports inside src/lib/queries/ go directly to
// the source module (./categories, ./optimistic, etc.), never through
// this barrel, to avoid circular module resolution.
//
// ---------------------------------------------------------------------
// Convention for owner-scoped private read helpers (`fetchLists`,
// `fetchGearItems`, `fetchCategories`, `fetchListItems`):
//
// Each helper takes a required `userId: string` parameter and applies
// it as an explicit `.eq('user_id', userId)` filter, even though RLS
// would gate ownership anyway. The redundant filter is defense in depth
// against the cross-channel leak from public *_select_shared policies.
// Without it, a signed-in user's `select('*')` would return own rows
// plus any other user's transitively-readable shared rows.
//
// See SECURITY.md "Query-level owner scoping" for the full rationale
// and the policy-level reason authenticated reads can match shared rows
// (each *_auth_select policy is `auth.uid() = user_id OR is_shared`).
//
// New private helpers must follow this pattern. Public-read helpers
// (`fetchSharedList`, `fetchSharedListItems`, `fetchSharedListCategories`)
// intentionally don't filter by user_id; they rely on the
// *_anon_select policies, and that asymmetry is the whole point
// of the cross-channel-leak defense.
// ---------------------------------------------------------------------
export { queryKeys } from './keys'
export { bulkUpdateSortOrder } from './bulk-reorder'
export {
  makeOptimisticReorder,
  makeOptimisticInsert,
  makeOptimisticUpdate,
  makeOptimisticUpdateWithFanout,
  makeOptimisticDelete,
  makeOptimisticBulkDelete,
  makeOptimisticBulkMove,
} from './optimistic'
export {
  fetchCategories,
  fetchSharedListCategories,
  createCategory,
  nextCategorySortOrder,
  updateCategory,
  deleteCategory,
  reorderCategories,
} from './categories'
export {
  fetchGearItems,
  createGearItem,
  nextGearItemSortOrder,
  updateGearItem,
  deleteGearItem,
  bulkDeleteGearItems,
  bulkMoveToCategoryGearItems,
  reorderGearItems,
  importGearItems,
} from './gear'
export {
  fetchFoodItems,
  createFoodItem,
  updateFoodItem,
  deleteFoodItem,
  nextFoodItemSortOrder,
  assertFoodItemWithinCap,
} from './food'
export type { FoodItemInput } from './food'
export {
  fetchLists,
  fetchSharedList,
  createList,
  nextListSortOrder,
  updateList,
  deleteList,
  reorderLists,
  createListFromSelection,
  duplicateList,
  createListWithImportedItems,
} from './lists'
export {
  fetchListItems,
  fetchAllUserListItems,
  fetchSharedListItems,
  addGearItemToList,
  updateListItem,
  deleteListItem,
  reorderListItems,
  resetPackedForList,
  resetReadyForList,
  importListFromCsv,
  nextListItemSortOrder,
} from './list-items'
export type { ListItemPatch } from './list-items'
export {
  GEAR_ITEM_CAP,
  LIST_ITEM_CAP,
  countNewGearForImport,
  assertGearImportWithinCap,
  assertListImportWithinCaps,
} from './import-helpers'
export { GEAR_ITEM_AUTH_SELECT, GEAR_ITEM_PUBLIC_SELECT } from './projections'
export {
  fetchFoodPlan, createFoodPlan, addFoodPlanDay, addMealDefinition, duplicateFoodPlanDay,
  upsertFoodPlanEntry, upsertFoodPlanEntries, updateFoodPlanEntry, deleteFoodPlanEntry, deleteFoodPlanDay,
  updateDayType, renameMeal, deleteMeal, deleteDayMeal, addDayMeal, deleteFoodPlan,
  assertFoodPlanDayWithinCap, assertMealDefinitionWithinCap, assertFoodPlanEntryWithinCap,
  saveFoodPlanTargets,
} from './food-plan'
export type { EntryAddition, EntryBatchAddition, TargetsSavePayload } from './food-plan'
export { fetchTargetDefaults, saveTargetDefaults } from './target-defaults'
export type { DefaultsSavePayload } from './target-defaults'
export {
  fetchFoodPackSignatures, fetchFoodPackState, setFoodPackState, invalidateFoodPlanCaches,
} from './food-pack'
export type { FoodPackSignature, FoodPackStateRow } from './food-pack'
