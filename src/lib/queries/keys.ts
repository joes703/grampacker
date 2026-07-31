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
  // Partial-match prefix. Changing what a list contains changes what a share
  // reports without touching the slug, and the share cache has a 30s staleTime,
  // so the writer invalidates every share it might hold rather than resolving
  // which slug moved (design 5.5).
  sharedListAll: () => ['shared-list'] as const,
}
