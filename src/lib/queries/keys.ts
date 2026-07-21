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
  packingLocations: (listId: string) => ['packing-locations', listId] as const,
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
  // Account-level default daily targets (Settings + takeout). Save is a full
  // replace returning the fresh set, written straight back here.
  targetDefaults: () => ['target-defaults'] as const,
  // The pack checklist's id set (design 6: row presence means packed). Only
  // read in pack mode with a plan attached; the toggle and the resets write
  // through it optimistically.
  //
  // The OBSERVED plan link is part of the key, for the same reason the
  // toggle carries it as a CAS expectation: a checkmark only means anything
  // under the plan it was made for. Relinking (which clears pack state
  // server-side, rule 1) then structurally cannot render the old plan's
  // cached ids as phantom pre-checks - the new link reads a fresh entry.
  foodPackState: (listId: string, foodPlanId: string) =>
    ['food-pack', listId, foodPlanId] as const,
  // Partial-match prefix: attach/detach/duplicate clear pack state
  // server-side (rule 1) from hooks that don't know which list's cache is
  // populated, so they invalidate the prefix (design 5.5 precedent).
  foodPackStateAll: () => ['food-pack'] as const,
  foodPlan: (planId: string | undefined) => ['food-plan', planId] as const,
  // Partial-match prefix over every cached plan document. The document carries
  // usedByList (the editor breadcrumb's data), which changes when a LIST
  // mutation moves a pointer - attach, detach, list delete/rename, list
  // duplicate. Those writers cannot know which plan documents are cached, so
  // they invalidate the prefix (design 5.5: coarse invalidation over
  // bookkeeping).
  foodPlanAll: () => ['food-plan'] as const,
}
