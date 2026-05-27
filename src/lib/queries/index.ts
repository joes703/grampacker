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
// and the policy-level reason the public policies have no `TO` clause.
//
// New private helpers must follow this pattern. Public-read helpers
// (`fetchSharedList`, `fetchSharedListItems`, `fetchSharedListCategories`)
// intentionally don't filter by user_id; they rely on the
// *_public_select_* policies, and that asymmetry is the whole point
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
  updateGearItem,
  deleteGearItem,
  bulkDeleteGearItems,
  bulkMoveToCategoryGearItems,
  reorderGearItems,
  importGearItems,
} from './gear'
export {
  fetchLists,
  fetchSharedList,
  createList,
  updateList,
  deleteList,
  reorderLists,
  createListFromSelection,
  duplicateList,
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
  importCsvRowsToList,
} from './list-items'
export type { ListItemPatch } from './list-items'
export { GEAR_ITEM_AUTH_SELECT, GEAR_ITEM_PUBLIC_SELECT } from './projections'
