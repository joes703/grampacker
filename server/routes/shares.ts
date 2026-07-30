import { Hono } from 'hono'
import type { SharedListResponse } from '../../shared/lists'
import {
  attachPublicShares,
  type PublicShareVars,
} from '../middleware/public-shares'
import type { PublicShare } from '../repos/public-shares'

// Authz matrix rows (docs/authz-matrix.md):
//   GET /api/shares/:slug - anon - gated on lists.is_shared; unknown slug
//                           and unshared list are the same 404
//
// The public read surface. GET-only (csrfProtection ignores safe methods),
// no session, no rate limit: a miss is a single indexed D1 read, the
// 62^6 slug space makes enumeration impractical, and a rate-limit counter
// would ADD a D1 write per anonymous view - strictly worse than the read
// it guards. The WAF stays the hardening layer (SECURITY.md trust model,
// ported from the old app).
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
  }
}

shareRoutes.get('/:slug', async (c) => {
  const share = await c.get('publicShares').getBySlug(c.req.param('slug'))
  if (!share) return c.json({ error: 'Not found' }, 404)
  return c.json(toSharedListResponse(share))
})
