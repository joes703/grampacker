// Canonical TanStack Query keys for every cache slice the app reads. Centralized
// here so a typo in a string literal can't silently fork the cache. Every other
// module in src/lib/queries/ imports from this file rather than re-deriving the
// shapes inline.
export const queryKeys = {
  categories: () => ['categories'] as const,
  gearItems: () => ['gear-items'] as const,
  foodItems: () => ['food-items'] as const,
  foodPlan: (listId: string) => ['food-plan', listId] as const,
  lists: () => ['lists'] as const,
  listItems: (listId: string) => ['list-items', listId] as const,
  // User-scoped so a same-tab account switch can't surface the previous
  // user's passkey metadata from cache (the global 30s staleTime would
  // otherwise serve it without a refetch).
  passkeys: (userId: string) => ['passkeys', userId] as const,
}
