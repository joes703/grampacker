// Canonical TanStack Query keys for every cache slice the app reads.
// Centralized here so a typo in a string literal cannot silently fork the
// cache (ported convention from the old repo). Every other module in
// src/lib/queries/ imports from this file rather than re-deriving the
// shapes inline. Grows one entry per transplanted slice.
export const queryKeys = {
  categories: () => ['categories'] as const,
  foodItems: () => ['food-items'] as const,
  gearItems: () => ['gear-items'] as const,
  lists: () => ['lists'] as const,
  listItems: (listId: string) => ['list-items', listId] as const,
  // Partial-match prefix for cross-cache operations (the gear fan-out
  // finds every per-list cache through this).
  listItemsAll: () => ['list-items'] as const,
  // Public /r/:slug read cache. Param accepts undefined because SharePage
  // reads the slug from the URL (useParams types it string | undefined);
  // the query is disabled until it exists.
  sharedList: (slug: string | undefined) => ['shared-list', slug] as const,
  // Partial-match prefix. Attaching/detaching a food plan changes what a share
  // reports without touching the slug, and the share cache has a 30s staleTime,
  // so the writer invalidates every share it might hold rather than resolving
  // which slug moved (design 5.5).
  sharedListAll: () => ['shared-list'] as const,
  // Food plans. The index caches the summary list; each editor caches ONE plan
  // document under its id (every plan mutation returns the fresh document, which
  // is written straight back here - design 5.5). planId accepts undefined for
  // the same reason as sharedList: FoodPlanEditor reads :id from the URL and the
  // query is disabled until it exists.
  foodPlans: () => ['food-plans'] as const,
  foodPlan: (planId: string | undefined) => ['food-plan', planId] as const,
}
