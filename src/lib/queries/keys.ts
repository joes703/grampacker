// Canonical TanStack Query keys for every cache slice the app reads.
// Centralized here so a typo in a string literal cannot silently fork the
// cache (ported convention from the old repo). Every other module in
// src/lib/queries/ imports from this file rather than re-deriving the
// shapes inline. Grows one entry per transplanted slice.
export const queryKeys = {
  categories: () => ['categories'] as const,
  gearItems: () => ['gear-items'] as const,
  lists: () => ['lists'] as const,
  listItems: (listId: string) => ['list-items', listId] as const,
  // Partial-match prefix for cross-cache operations (the gear fan-out
  // finds every per-list cache through this).
  listItemsAll: () => ['list-items'] as const,
  listFood: (listId: string) => ['list-food', listId] as const,
  packingLocations: (listId: string) => ['packing-locations', listId] as const,
  // Public /r/:slug read cache. Param accepts undefined because SharePage
  // reads the slug from the URL (useParams types it string | undefined);
  // the query is disabled until it exists.
  sharedList: (slug: string | undefined) => ['shared-list', slug] as const,
}

// Canonical mutation keys, here for the same reason queryKeys is: an inline
// string literal is invisible to review and a typo produces a plausible-looking
// log line rather than an error. Every useMutation in the app takes its key from
// here, and eslint.config.js refuses a useMutation call that does not.
//
// A key is not decoration. Two things in TanStack Query 5 switch on it:
//
//  1. Mutation filters match by PREFIX, not equality. use-list-item-actions
//     gates its last-one-out invalidation on
//     `qc.isMutating({mutationKey: updateListItem(listId)}) > 1`, so a key that
//     STARTS WITH another key's elements would silently join that burst gate and
//     suppress an invalidation - a stale-cache bug with no error anywhere. No
//     key here may be a prefix of another, which keys.test.ts asserts.
//  2. setMutationDefaults is prefix-matched, and a MutationObserver RESETS when
//     its key changes. The app sets no mutation defaults today, so the first is
//     latent; the second is why every key below is static for the lifetime of a
//     component instance. The `listId` ones change only when the route changes,
//     which remounts anyway.
export const mutationKeys = {
  // Lists. Rename/duplicate/delete/flag-toggle are NOT list-scoped: their hooks
  // take the id per call (useCurrentListActions operates on whichever card the
  // user hit), so a key carrying one would change under a live mutation - the
  // MutationObserver reset in note 2 above.
  createList: () => ['create-list'] as const,
  createListFromSelection: () => ['create-list-from-selection'] as const,
  renameList: () => ['rename-list'] as const,
  duplicateList: () => ['duplicate-list'] as const,
  deleteList: () => ['delete-list'] as const,
  importList: () => ['import-list'] as const,
  toggleListFlag: () => ['toggle-list-flag'] as const,
  rotateShareLink: () => ['rotate-share-link'] as const,
  updateListNotes: (listId: string) => ['update-list-notes', listId] as const,

  // List items. `updateListItem` keeps the exact shape it had when it was an
  // inline literal, because the isMutating gate above depends on it.
  addListItem: (listId: string) => ['add-list-item', listId] as const,
  addNewListItem: (listId: string) => ['add-new-list-item', listId] as const,
  updateListItem: (listId: string) => ['update-list-item', listId] as const,
  deleteListItem: (listId: string) => ['delete-list-item', listId] as const,
  moveListItem: (listId: string) => ['move-list-item', listId] as const,
  moveFoodItem: (listId: string) => ['move-food-item', listId] as const,
  updateFoodPackState: (listId: string) => ['update-food-pack-state', listId] as const,
  reorderListItems: (listId: string) => ['reorder-list-items', listId] as const,
  reorderPackItems: (listId: string) => ['reorder-pack-items', listId] as const,

  // Packing locations
  createPackingLocation: (listId: string) => ['create-packing-location', listId] as const,
  createItemContainer: (listId: string) => ['create-item-container', listId] as const,
  renamePackingLocation: (listId: string) => ['rename-packing-location', listId] as const,
  removePackingLocation: (listId: string) => ['remove-packing-location', listId] as const,

  // Gear library
  addGearItem: () => ['add-gear-item'] as const,
  editGearItem: () => ['edit-gear-item'] as const,
  removeGearItem: () => ['remove-gear-item'] as const,
  importGearItems: () => ['import-gear-items'] as const,
  bulkDeleteGear: () => ['bulk-delete-gear'] as const,
  bulkMoveGear: () => ['bulk-move-gear'] as const,
  reorderGearItems: () => ['reorder-gear-items'] as const,
  addGearCategory: () => ['add-gear-category'] as const,
  renameGearCategory: () => ['rename-gear-category'] as const,
  removeGearCategory: () => ['remove-gear-category'] as const,

  // Gear edited from inside a list (the dialog on ListDetailPage), distinct
  // from the library-page mutations above: same server routes, different cache
  // fan-out and different failure surface.
  updateGearFromList: () => ['update-gear-from-list'] as const,
  deleteGearFromList: () => ['delete-gear-from-list'] as const,
  addCategoryFromList: () => ['add-category-from-list'] as const,

  // Food
  setFoodDays: (listId: string) => ['set-food-days', listId] as const,
  createFoodItem: (listId: string) => ['create-food-item', listId] as const,
  setFoodItemSlots: (listId: string) => ['set-food-item-slots', listId] as const,
  setFoodItemQuantity: (listId: string) =>
    ['set-food-item-quantity', listId] as const,
  setFoodItemMode: (listId: string) => ['set-food-item-mode', listId] as const,
  deleteFoodItem: (listId: string) => ['delete-food-item', listId] as const,

  // The generic drag-reorder hook, keyed by the dnd kind it was configured for
  // so two reorderable surfaces on one page do not share an identity.
  reorder: (dndKind: string) => ['reorder', dndKind] as const,
}
