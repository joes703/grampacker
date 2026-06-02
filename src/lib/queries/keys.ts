// Canonical TanStack Query keys for every cache slice the app reads. Centralized
// here so a typo in a string literal can't silently fork the cache. Every other
// module in src/lib/queries/ imports from this file rather than re-deriving the
// shapes inline.
export const queryKeys = {
  categories: () => ['categories'] as const,
  gearItems: () => ['gear-items'] as const,
  lists: () => ['lists'] as const,
  listItems: (listId: string) => ['list-items', listId] as const,
  passkeys: () => ['passkeys'] as const,
}
