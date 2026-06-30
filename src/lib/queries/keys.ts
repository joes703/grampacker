// Canonical TanStack Query keys for every cache slice the app reads. Centralized
// here so a typo in a string literal can't silently fork the cache. Every other
// module in src/lib/queries/ imports from this file rather than re-deriving the
// shapes inline.
export const queryKeys = {
  categories: () => ['categories'] as const,
  gearItems: () => ['gear-items'] as const,
  foodItems: () => ['food-items'] as const,
  // Narrow projection of food_items for the /lists/:id packing projection. A
  // separate cache entry from foodItems because the two responses are different
  // row shapes; see fetchFoodItemsLite. Every food_items write invalidates both.
  foodItemsLite: () => ['food-items-lite'] as const,
  foodPlansAll: () => ['food-plan'] as const,
  foodPlan: (listId: string) => ['food-plan', listId] as const,
  foodPlanCopyOptions: (userId: string, targetListId: string) => ['food-plan-copy-options', userId, targetListId] as const,
  sharedFoodSummary: (slug: string) => ['shared-food-summary', slug] as const,
  sharedFoodPlan: (slug: string) => ['shared-food-plan', slug] as const,
  // Public /r/:slug read caches. Params accept undefined because SharePage
  // keys these off `slug` / `list?.id` before either has resolved; the queries
  // are `enabled`-gated, so the undefined key is never actually populated.
  sharedList: (slug: string | undefined) => ['shared-list', slug] as const,
  sharedListItems: (listId: string | undefined) => ['shared-list-items', listId] as const,
  sharedListCategories: (listId: string | undefined, categoryIdsKey: string) =>
    ['shared-list-categories', listId, categoryIdsKey] as const,
  foodPackSignaturesAll: () => ['food-pack-signatures'] as const,
  foodPackSignatures: (listId: string) => ['food-pack-signatures', listId] as const,
  foodPackStateAll: () => ['food-pack-state'] as const,
  foodPackState: (listId: string) => ['food-pack-state', listId] as const,
  lists: () => ['lists'] as const,
  // Head-count of the user's lists, deliberately a child of `lists` so that
  // every existing `invalidateQueries({ queryKey: queryKeys.lists() })` on a
  // list create/delete/update also refreshes the count through TanStack's
  // prefix matching - no separate invalidation call is needed at any mutation
  // site. Mirrors the listItemsAll/listItems and foodPlansAll/foodPlan shape.
  // (getQueryData is exact-match, so reading ['lists'] still returns List[],
  // never the count.)
  listCount: () => ['lists', 'count'] as const,
  listItems: (listId: string) => ['list-items', listId] as const,
  // Prefix key for fan-out scans / broad invalidation across every per-list
  // ['list-items', listId] cache (mirrors the foodPlansAll / foodPackSignaturesAll
  // pattern). Used by the gear-mutation fan-out and the GearLibraryPage bulk paths.
  listItemsAll: () => ['list-items'] as const,
  // User-scoped so a same-tab account switch can't surface the previous
  // user's passkey metadata from cache (the global 30s staleTime would
  // otherwise serve it without a refetch).
  passkeys: (userId: string) => ['passkeys', userId] as const,
  // User-scoped: a same-tab account switch must not surface the previous
  // user's default targets from cache.
  targetDefaults: (userId: string) => ['target-defaults', userId] as const,
}
