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
// gates ownership anyway. The redundant filter is defense in depth and
// keeps query intent obvious.
//
// See SECURITY.md "Query-level owner scoping" for the full rationale.
//
// New private helpers must follow this pattern. Public-read helpers
// (`fetchSharedList`, `fetchSharedListItems`, `fetchSharedListCategories`)
// intentionally don't filter by user_id; they read curated public views
// that physically omit private columns.
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
  fetchFoodItemsLite,
  createFoodItem,
  updateFoodItem,
  deleteFoodItem,
  nextFoodItemSortOrder,
  assertFoodItemWithinCap,
  assertFoodImportWithinCap,
  importFoodItems,
} from './food'
export type { FoodItemInput, FoodItemLite } from './food'
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
export { GEAR_ITEM_AUTH_SELECT } from './projections'
export {
  fetchSharedFoodSummary, fetchSharedFoodPlan,
  fetchFoodPlan, createFoodPlan, fetchFoodPlanCopyOptions, copyFoodPlanToList, loadSampleFoodPlan,
  addFoodPlanDay, addMealDefinition, duplicateFoodPlanDay,
  upsertFoodPlanEntry, upsertFoodPlanEntries, updateFoodPlanEntry, deleteFoodPlanEntry, deleteFoodPlanDay,
  updateDayType, renameMeal, deleteMeal, deleteDayMeal, addDayMeal, deleteFoodPlan, updateFoodPlanShare,
  assertFoodPlanDayWithinCap, assertMealDefinitionWithinCap, assertFoodPlanEntryWithinCap,
  saveFoodPlanTargets, fetchAllUserFoodData,
} from './food-plan'
export type { EntryAddition, EntryBatchAddition, FoodPlanCopyOption, TargetsSavePayload, FoodTakeoutData } from './food-plan'
export { fetchTargetDefaults, saveTargetDefaults } from './target-defaults'
export type { DefaultsSavePayload } from './target-defaults'
export {
  fetchFoodPackSignatures, fetchFoodPackState, setFoodPackState, invalidateFoodPlanCaches,
} from './food-pack'
export type { FoodPackSignature, FoodPackStateRow } from './food-pack'
