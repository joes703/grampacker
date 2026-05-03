// Public barrel for the queries domain. External consumers import from
// '@/lib/queries' (or '../lib/queries'), never from a specific submodule —
// the per-domain file layout is an internal organizational concern.
//
// Internal cross-module imports inside src/lib/queries/ go directly to the
// source module (./categories, ./optimistic, etc.) — never through this
// barrel — to avoid circular module resolution.
export { queryKeys } from './keys'
export {
  bulkUpdateSortOrder,
  makeOptimisticReorder,
  makeOptimisticInsert,
  makeOptimisticUpdate,
  makeOptimisticDelete,
} from './optimistic'
export {
  fetchCategories,
  fetchSharedListCategories,
  createCategory,
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
  importCsvRowsToList,
} from './list-items'
export type { ListItemPatch } from './list-items'
