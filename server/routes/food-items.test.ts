import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import {
  foodItemResponseSchema,
  type FoodItemResponse,
} from '../../shared/food'
import { isFoodCapError } from '../repos/food-items'
import { apiRequest } from '../test/api-helpers'
import { signUpVerifiedUser } from '../test/auth-helpers'

async function createFood(
  cookie: string,
  body: Record<string, unknown>,
): Promise<FoodItemResponse> {
  const res = await apiRequest(cookie, 'POST', '/api/food-items', body)
  if (res.status !== 201) throw new Error(`create failed: ${res.status}`)
  return foodItemResponseSchema.parse(await res.json())
}

async function listFood(cookie: string): Promise<FoodItemResponse[]> {
  const res = await apiRequest(cookie, 'GET', '/api/food-items')
  return foodItemResponseSchema.array().parse(await res.json())
}

async function userIdFor(cookie: string): Promise<string> {
  const res = await apiRequest(cookie, 'GET', '/api/me')
  const body = (await res.json()) as { id: string }
  return body.id
}

const RESPONSE_KEYS = [
  'id',
  'name',
  'brand',
  'servingDescription',
  'servingWeightGrams',
  'caloriesPerServing',
  'servingsPerPackage',
  'fatGrams',
  'saturatedFatGrams',
  'carbsGrams',
  'fiberGrams',
  'sugarGrams',
  'proteinGrams',
  'sodiumMg',
  'potassiumMg',
  'notes',
  'sortOrder',
  'createdAt',
  'updatedAt',
].sort()

describe('/api/food-items authorization matrix', () => {
  it('anon requests are 401 on every route', async () => {
    for (const [method, path, body] of [
      ['GET', '/api/food-items', undefined],
      ['POST', '/api/food-items', { name: 'X', servingWeightGrams: 10, caloriesPerServing: 100 }],
      ['PATCH', '/api/food-items/some-id', { name: 'X' }],
      ['DELETE', '/api/food-items/some-id', undefined],
    ] as const) {
      const res = await apiRequest(null, method, path, body)
      expect(res.status, `${method} ${path}`).toBe(401)
    }
  })

  it('create round-trips every field; minimal create gets the defaults', async () => {
    const { cookie } = await signUpVerifiedUser('food-create@example.com', 'F')

    const full = await createFood(cookie, {
      name: 'Ramen',
      brand: 'Maruchan',
      servingDescription: '1 block',
      servingWeightGrams: 85,
      caloriesPerServing: 380,
      servingsPerPackage: 2,
      fatGrams: 14,
      saturatedFatGrams: 7,
      carbsGrams: 52,
      fiberGrams: 2,
      sugarGrams: 1,
      proteinGrams: 8,
      sodiumMg: 1520,
      potassiumMg: 150,
      notes: 'trail staple',
    })
    expect(full.brand).toBe('Maruchan')
    expect(full.servingDescription).toBe('1 block')
    expect(full.servingWeightGrams).toBe(85)
    expect(full.caloriesPerServing).toBe(380)
    expect(full.servingsPerPackage).toBe(2)
    expect(full.fatGrams).toBe(14)
    expect(full.sodiumMg).toBe(1520)
    expect(full.notes).toBe('trail staple')
    expect(full.sortOrder).toBe(0)
    // Allowlist: user_id never leaves the server.
    expect(Object.keys(full).sort()).toEqual(RESPONSE_KEYS)

    const minimal = await createFood(cookie, {
      name: 'Olive oil',
      servingWeightGrams: 13.5,
      caloriesPerServing: 119,
    })
    expect(minimal).toMatchObject({
      brand: null,
      servingDescription: null,
      servingWeightGrams: 13.5, // REAL round-trips the fractional value exactly
      servingsPerPackage: null,
      fatGrams: null,
      saturatedFatGrams: null,
      carbsGrams: null,
      fiberGrams: null,
      sugarGrams: null,
      proteinGrams: null,
      sodiumMg: null,
      potassiumMg: null,
      notes: null,
      sortOrder: 1, // server-assigned max+1
    })
  })

  it('GET returns only the caller rows (two-user isolation)', async () => {
    const a = await signUpVerifiedUser('food-iso-a@example.com', 'A')
    const b = await signUpVerifiedUser('food-iso-b@example.com', 'B')
    const mine = await createFood(a.cookie, {
      name: 'Mine',
      servingWeightGrams: 10,
      caloriesPerServing: 50,
    })
    await createFood(b.cookie, {
      name: 'Theirs',
      servingWeightGrams: 10,
      caloriesPerServing: 50,
    })

    const seen = await listFood(a.cookie)
    expect(seen.map((f) => f.id)).toEqual([mine.id])
  })

  it('the response body is a strict allowlist (no userId leak) - asserted on RAW json', async () => {
    // Assert on the UNPARSED body: schema.parse() strips unknown keys, so a
    // leaked userId would be silently dropped and a keys-of-parsed check would
    // pass anyway (Codex finding). Read the wire bytes instead.
    const { cookie } = await signUpVerifiedUser('food-allowlist@example.com', 'A')

    const postRes = await apiRequest(cookie, 'POST', '/api/food-items', {
      name: 'Raw',
      servingWeightGrams: 10,
      caloriesPerServing: 50,
    })
    const created = (await postRes.json()) as Record<string, unknown>
    expect(Object.keys(created).sort()).toEqual(RESPONSE_KEYS)
    expect(created).not.toHaveProperty('userId')
    expect(created).not.toHaveProperty('user_id')

    const listRes = await apiRequest(cookie, 'GET', '/api/food-items')
    const list = (await listRes.json()) as Record<string, unknown>[]
    expect(list).toHaveLength(1)
    for (const row of list) {
      expect(Object.keys(row).sort()).toEqual(RESPONSE_KEYS)
      expect(row).not.toHaveProperty('userId')
      expect(row).not.toHaveProperty('user_id')
    }

    const patchRes = await apiRequest(
      cookie,
      'PATCH',
      `/api/food-items/${String(created.id)}`,
      { name: 'Raw 2' },
    )
    const patched = (await patchRes.json()) as Record<string, unknown>
    expect(Object.keys(patched).sort()).toEqual(RESPONSE_KEYS)
    expect(patched).not.toHaveProperty('userId')
    expect(patched).not.toHaveProperty('user_id')
  })

  it('PATCH: partial updates, null clears, empty patch rejected', async () => {
    const { cookie } = await signUpVerifiedUser('food-patch@example.com', 'P')
    const item = await createFood(cookie, {
      name: 'Bar',
      servingWeightGrams: 60,
      caloriesPerServing: 250,
      servingsPerPackage: 1,
      proteinGrams: 10,
    })

    const renamed = await apiRequest(cookie, 'PATCH', `/api/food-items/${item.id}`, {
      name: 'Protein bar',
    })
    expect(renamed.status).toBe(200)
    expect(foodItemResponseSchema.parse(await renamed.json())).toMatchObject({
      name: 'Protein bar',
      proteinGrams: 10, // untouched
    })

    // null clears a nullable field.
    const cleared = await apiRequest(cookie, 'PATCH', `/api/food-items/${item.id}`, {
      servingsPerPackage: null,
      proteinGrams: null,
    })
    expect(foodItemResponseSchema.parse(await cleared.json())).toMatchObject({
      servingsPerPackage: null,
      proteinGrams: null,
    })

    // Empty patch is a 400.
    const empty = await apiRequest(cookie, 'PATCH', `/api/food-items/${item.id}`, {})
    expect(empty.status).toBe(400)
  })

  it('non-owner PATCH/DELETE are 404 and change nothing', async () => {
    const a = await signUpVerifiedUser('food-nonown-a@example.com', 'A')
    const b = await signUpVerifiedUser('food-nonown-b@example.com', 'B')
    const item = await createFood(a.cookie, {
      name: 'Couscous',
      servingWeightGrams: 100,
      caloriesPerServing: 376,
    })

    expect(
      (
        await apiRequest(b.cookie, 'PATCH', `/api/food-items/${item.id}`, {
          name: 'Mine now',
        })
      ).status,
    ).toBe(404)
    expect(
      (await apiRequest(b.cookie, 'DELETE', `/api/food-items/${item.id}`)).status,
    ).toBe(404)

    const after = await listFood(a.cookie)
    expect(after).toHaveLength(1)
    expect(after[0]?.name).toBe('Couscous')
  })

  it('DELETE removes the caller own row', async () => {
    const { cookie } = await signUpVerifiedUser('food-delete@example.com', 'D')
    const item = await createFood(cookie, {
      name: 'Gone',
      servingWeightGrams: 10,
      caloriesPerServing: 10,
    })
    expect(
      (await apiRequest(cookie, 'DELETE', `/api/food-items/${item.id}`)).status,
    ).toBe(204)
    expect(await listFood(cookie)).toHaveLength(0)
    // Deleting again is a 404.
    expect(
      (await apiRequest(cookie, 'DELETE', `/api/food-items/${item.id}`)).status,
    ).toBe(404)
  })

  it('the 1000 cap: friendly 422 from the API, trigger backstop on raw inserts', async () => {
    const { cookie } = await signUpVerifiedUser('food-cap@example.com', 'Cap')
    const userId = await userIdFor(cookie)

    // Seed 999 rows directly (the API path would be 999 round trips).
    const values = Array.from({ length: 999 }, (_, i) => {
      return `('seed-${i}', '${userId}', 'Seed food ${i}', 1, 0, ${i}, 0, 0)`
    }).join(',')
    await env.DB.prepare(
      `insert into food_items (id, user_id, name, serving_weight_grams, calories_per_serving, sort_order, created_at, updated_at) values ${values}`,
    ).run()

    // 1000th via the API is fine...
    const at1000 = await apiRequest(cookie, 'POST', '/api/food-items', {
      name: 'The 1000th',
      servingWeightGrams: 10,
      caloriesPerServing: 100,
    })
    expect(at1000.status).toBe(201)

    // ...the 1001st gets a friendly 422 (the trigger fires, the repo maps it).
    const over = await apiRequest(cookie, 'POST', '/api/food-items', {
      name: 'One too many',
      servingWeightGrams: 10,
      caloriesPerServing: 100,
    })
    expect(over.status).toBe(422)

    // ...and the DB trigger backstops writes that bypass the repo.
    await expect(
      env.DB.prepare(
        `insert into food_items (id, user_id, name, serving_weight_grams, calories_per_serving, sort_order, created_at, updated_at) values ('bypass', '${userId}', 'Bypass', 1, 0, 0, 0, 0)`,
      ).run(),
    ).rejects.toThrow(/cap/)
  })

  it('isFoodCapError matches only the root SQLite trigger error, never wrapper params', () => {
    // A food literally NAMED like the trigger message must not turn an
    // unrelated failure into a false 422 (the outer wrapper embeds params).
    const fkRoot = new Error(
      'FOREIGN KEY constraint failed: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_FOREIGNKEY)',
    )
    const fkD1 = new Error('D1_ERROR: FOREIGN KEY constraint failed', {
      cause: fkRoot,
    })
    const fkWrapper = new Error(
      'Failed query: insert into "food_items" ... params: abc,food item cap exceeded (1000 per user): SQLITE_CONSTRAINT_TRIGGER,0',
      { cause: fkD1 },
    )
    expect(isFoodCapError(fkWrapper)).toBe(false)

    // The real trigger shape (pinned live by the 1001st-item test above).
    const capRoot = new Error(
      'food item cap exceeded (1000 per user): SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_TRIGGER)',
    )
    const capD1 = new Error(`D1_ERROR: ${capRoot.message}`, { cause: capRoot })
    const capWrapper = new Error('Failed query: insert into "food_items" ...', {
      cause: capD1,
    })
    expect(isFoodCapError(capWrapper)).toBe(true)
    expect(isFoodCapError(new Error('unrelated'))).toBe(false)
    expect(isFoodCapError(null)).toBe(false)
  })

  it('validation: bounds, decimals, positivity, null-vs-invalid, strictness', async () => {
    const { cookie } = await signUpVerifiedUser('food-valid@example.com', 'V')
    const base = { name: 'V', servingWeightGrams: 10, caloriesPerServing: 100 }
    const reject = async (body: Record<string, unknown>) => {
      const res = await apiRequest(cookie, 'POST', '/api/food-items', body)
      expect(res.status, JSON.stringify(body)).toBe(400)
    }

    // serving weight is strictly > 0 (0 is NOT allowed, unlike calories).
    await reject({ ...base, servingWeightGrams: 0 })
    await reject({ ...base, servingWeightGrams: -1 })
    // servings per package: > 0, so -1 is INVALID, not silently null.
    await reject({ ...base, servingsPerPackage: -1 })
    await reject({ ...base, servingsPerPackage: 0 })
    // decimal-place caps mirror numeric(10,d).
    await reject({ ...base, servingWeightGrams: 1.2345 }) // > 3 dp
    await reject({ ...base, caloriesPerServing: 1.234 }) // > 2 dp
    await reject({ ...base, sodiumMg: 1.23 }) // > 1 dp
    // ...and the cap must hold near the upper bound, where an epsilon check
    // would wrongly pass an 8-decimal value (Codex finding).
    await reject({ ...base, caloriesPerServing: 99_999_999.009_999_99 })
    // A NUL byte passes zod's min(1) but SQLite length() sees 0; reject it in
    // the schema so it is a 400, not an unmapped 500 (Codex finding).
    await reject({ ...base, name: '\u0000abc' })
    // macros are >= 0; negative rejected.
    await reject({ ...base, proteinGrams: -1 })
    // over-bounds.
    await reject({ ...base, servingWeightGrams: 10_000_000 })
    // blank strings are not valid - clients send null to clear.
    await reject({ ...base, brand: '' })
    // required fields missing.
    await reject({ name: 'V', caloriesPerServing: 100 })
    await reject({ name: 'V', servingWeightGrams: 10 })
    // unknown keys rejected (.strict()).
    await reject({ ...base, calories: 100 })

    // servingsPerPackage: null is explicitly ACCEPTED (a by-weight food).
    const ok = await apiRequest(cookie, 'POST', '/api/food-items', {
      ...base,
      servingsPerPackage: null,
    })
    expect(ok.status).toBe(201)
  })
})
