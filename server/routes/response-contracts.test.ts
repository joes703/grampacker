import { describe, expect, it } from 'vitest'
import { deepStrict } from '../../shared/deep-strict'
import {
  listResponseSchema,
  listItemResponseSchema,
  packingLocationResponseSchema,
  sharedListResponseSchema,
} from '../../shared/lists'
import {
  categoryResponseSchema,
  gearItemResponseSchema,
  importGearResponseSchema,
} from '../../shared/gear'
import { foodItemResponseSchema, listFoodResponseSchema } from '../../shared/food'
import { meResponseSchema } from '../../shared/me'
import { healthResponseSchema } from '../../shared/health'
import { apiRequest } from '../test/api-helpers'
import { signUpVerifiedUser } from '../test/auth-helpers'

// The CI half of the response-shape contract (review P2.13, owner decision
// 2026-08-05): the browser's runtime schemas stay tolerant so deploy-window
// skew cannot fail a committed write, and THIS file is what makes additive
// drift fail loudly instead - every response schema gets one representative
// endpoint whose RAW json must parse against the deep-strict variant. A new
// field on any of these wire shapes goes red here until the schema names it.

async function strictJson(
  res: Response,
  schema: Parameters<typeof deepStrict>[0],
  expectStatus: number,
) {
  expect(res.status).toBe(expectStatus)
  const raw: unknown = await res.json()
  const parsed = deepStrict(schema).safeParse(raw)
  expect(
    parsed.success,
    parsed.success ? undefined : JSON.stringify(parsed.error.issues, null, 2),
  ).toBe(true)
  return raw
}

describe('every response schema, strict against the raw wire shape', () => {
  it('covers the full authenticated surface plus health and the share', async () => {
    const { cookie } = await signUpVerifiedUser('contracts@example.com', 'CT')

    await strictJson(
      await apiRequest(null, 'GET', '/api/health'),
      healthResponseSchema,
      200,
    )
    await strictJson(
      await apiRequest(cookie, 'GET', '/api/me'),
      meResponseSchema,
      200,
    )

    const listRaw = (await strictJson(
      await apiRequest(cookie, 'POST', '/api/lists', { name: 'Trip' }),
      listResponseSchema,
      201,
    )) as { id: string; slug: string }

    await strictJson(
      await apiRequest(cookie, 'POST', '/api/categories', { name: 'Shelter' }),
      categoryResponseSchema,
      201,
    )

    const gearRaw = (await strictJson(
      await apiRequest(cookie, 'POST', '/api/gear-items', {
        name: 'Tent',
        weightGrams: 900,
      }),
      gearItemResponseSchema,
      201,
    )) as { id: string }

    await strictJson(
      await apiRequest(cookie, 'POST', `/api/lists/${listRaw.id}/items`, {
        gearItemId: gearRaw.id,
      }),
      listItemResponseSchema,
      201,
    )

    await strictJson(
      await apiRequest(
        cookie,
        'POST',
        `/api/lists/${listRaw.id}/packing-locations`,
        { name: 'Main pack' },
      ),
      packingLocationResponseSchema,
      201,
    )

    await strictJson(
      await apiRequest(cookie, 'POST', '/api/gear-items/import', {
        categories: [{ tempId: 'c1', name: 'Cooking' }],
        items: [{ name: 'Stove', category: { kind: 'new', tempId: 'c1' } }],
      }),
      importGearResponseSchema,
      201,
    )

    const foodRaw = (await strictJson(
      await apiRequest(cookie, 'PUT', `/api/lists/${listRaw.id}/food/days`, {
        days: 1,
      }),
      listFoodResponseSchema,
      200,
    )) as { slots: { id: string }[] }
    const slotId = foodRaw.slots[0]?.id
    if (!slotId) throw new Error('no slot generated')

    await strictJson(
      await apiRequest(cookie, 'POST', `/api/lists/${listRaw.id}/food/items`, {
        name: 'Oats',
        weightGrams: 90,
        quantity: 1,
        slotIds: [slotId],
      }),
      foodItemResponseSchema,
      201,
    )

    // The share, anonymously - the one response where strictness also runs
    // SERVER-side on every request (routes/shares.ts).
    const share = await apiRequest(cookie, 'PATCH', `/api/lists/${listRaw.id}`, {
      isShared: true,
    })
    expect(share.status).toBe(200)
    await strictJson(
      await apiRequest(null, 'GET', `/api/shares/v2/${listRaw.slug}`),
      sharedListResponseSchema,
      200,
    )
  })
})
