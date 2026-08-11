import { Hono } from 'hono'
import { sharedListResponseSchema, type SharedListResponse } from '../../shared/lists'
import { deepStrict } from '../../shared/deep-strict'
import {
  attachPublicShares,
  type PublicShareVars,
} from '../middleware/public-shares'
import type { PublicShare } from '../repos/public-shares'

// Authz matrix rows (docs/authz-matrix.md):
//   GET /api/shares/v2/:slug - anon - gated on lists.is_shared; unknown slug
//                           and unshared list are the same 404
//
// The public read surface. GET-only (csrfProtection ignores safe methods),
// no session - and, since 2026-08-10, METERED. It used to argue itself out
// of a budget on the grounds that a counter adds a D1 write per anonymous
// view, which is true and still the cost; what that argument missed is that
// this is the ONE route where an unmetered read is also an unauthenticated
// one. The budget is two per-IP buckets mounted in server/index.ts (generous
// on every request, tight on misses) - see the rules in
// middleware/rate-limit.ts for why one bucket could not do both jobs. The
// WAF remains the volumetric layer (SECURITY.md trust model).
export const shareRoutes = new Hono<{
  Bindings: Env
  Variables: PublicShareVars
}>()

shareRoutes.use('*', attachPublicShares)

// Field-by-field on purpose (never a spread): this mapping IS the runtime
// response allowlist. A column added to the repo rows does not reach the
// wire unless someone names it here, and shares.test.ts asserts the
// forbidden keys stay absent.
function toSharedListResponse(share: PublicShare): SharedListResponse {
  return {
    list: {
      name: share.list.name,
      description: share.list.description,
      groupWorn: share.list.groupWorn,
      isDraft: share.list.isDraft,
    },
    categories: share.categories.map((row) => ({
      id: row.id,
      name: row.name,
      sortOrder: row.sortOrder,
    })),
    items: share.items.map((row) => ({
      id: row.id,
      gearItemId: row.gearItemId,
      quantity: row.quantity,
      isWorn: row.isWorn,
      isConsumable: row.isConsumable,
      sortOrder: row.sortOrder,
      gear: {
        name: row.gearName,
        description: row.gearDescription,
        weightGrams: row.gearWeightGrams,
        categoryId: row.gearCategoryId,
      },
    })),
    // Aggregate only - see publicFoodSchema. The repo sums the food items
    // table alone; joining to slots would multiply one bag of trail mix by
    // the number of meals it is scheduled for.
    food: {
      weightGrams: share.foodWeightGrams,
    },
  }
}

// Belt to the mapping's braces: the outgoing DTO is re-validated against the
// deep-strict schema at the boundary, so a field that somehow got past the
// field-by-field mapping 500s in every test run instead of shipping to an
// anonymous reader. This is the ONE response where client-side stripping was
// doing security work; the server is the only place that work cannot be
// bypassed (review P2.13).
const strictShareResponse = deepStrict(sharedListResponseSchema)

// Every outcome, 200 and 404 alike. Unsharing flips is_shared server-side,
// but a response already sitting in a browser cache keeps being served from
// there - so "I made this private again" was true of the server and false of
// anyone who had already loaded the link. no-store is the only value that
// prevents the store outright; private alone still permits a browser cache.
//
// The 404 carries it too: without that, a not-yet-shared slug could cache a
// 404 and keep denying a list its owner has since shared.
//
// This does NOT repair responses cached under the OLD policy - a stored entry
// keeps the headers it was stored with, and our 304s carry no Cache-Control
// either (AGENTS.md). That is why the path moved to /v2 in the same change:
// a new URL is a new cache key, so every reader starts clean. Public /r/:slug
// links are untouched - this is the internal API path, not the share link.
//
// What that leaves, stated rather than glossed: a tab still running the OLD
// bundle asks for the old path, gets a 404, and its fetcher maps 404 to null,
// so it renders "List not found" - it does NOT reload (there is no service
// worker). A stale tab holding an already-cached old 200 can keep showing it
// until that entry expires. Both resolve on the next navigation, which serves
// the current bundle and /v2. Accepted: stale open tabs are explicitly not
// supported, and the alternative - leaving the old path mounted - keeps
// serving exactly the cacheable responses this change exists to stop.
const NO_STORE = 'private, no-store'

shareRoutes.get('/v2/:slug', async (c) => {
  const share = await c.get('publicShares').getBySlug(c.req.param('slug'))
  if (!share) {
    c.header('Cache-Control', NO_STORE)
    return c.json({ error: 'Not found' }, 404)
  }
  const body = toSharedListResponse(share)
  strictShareResponse.parse(body)
  c.header('Cache-Control', NO_STORE)
  return c.json(body)
})
