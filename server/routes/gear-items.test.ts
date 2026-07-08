import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import {
  categoryResponseSchema,
  gearItemResponseSchema,
  type GearItemResponse,
} from '../../shared/gear'
import { isCapError } from '../repos/gear-items'
import { apiRequest } from '../test/api-helpers'
import { signUpVerifiedUser } from '../test/auth-helpers'

async function createGear(
  cookie: string,
  body: Record<string, unknown>,
): Promise<GearItemResponse> {
  const res = await apiRequest(cookie, 'POST', '/api/gear-items', body)
  if (res.status !== 201) throw new Error(`create failed: ${res.status}`)
  return gearItemResponseSchema.parse(await res.json())
}

async function listGear(cookie: string): Promise<GearItemResponse[]> {
  const res = await apiRequest(cookie, 'GET', '/api/gear-items')
  return gearItemResponseSchema.array().parse(await res.json())
}

async function createCategory(cookie: string, name: string): Promise<string> {
  const res = await apiRequest(cookie, 'POST', '/api/categories', { name })
  return categoryResponseSchema.parse(await res.json()).id
}

async function userIdFor(cookie: string): Promise<string> {
  const res = await apiRequest(cookie, 'GET', '/api/me')
  const body = (await res.json()) as { id: string }
  return body.id
}

describe('/api/gear-items authorization matrix', () => {
  it('anon requests are 401 on every route', async () => {
    for (const [method, path, body] of [
      ['GET', '/api/gear-items', undefined],
      ['POST', '/api/gear-items', { name: 'X' }],
      ['PUT', '/api/gear-items/order', [{ id: 'a', sortOrder: 0 }]],
      ['POST', '/api/gear-items/bulk-delete', { ids: ['a'] }],
      ['POST', '/api/gear-items/bulk-move', { ids: ['a'], categoryId: null }],
      ['PATCH', '/api/gear-items/some-id', { name: 'X' }],
      ['DELETE', '/api/gear-items/some-id', undefined],
    ] as const) {
      const res = await apiRequest(null, method, path, body)
      expect(res.status, `${method} ${path}`).toBe(401)
    }
  })

  it('create round-trips every field; minimal create gets the defaults', async () => {
    const { cookie } = await signUpVerifiedUser('gear-create@example.com', 'G')
    const catId = await createCategory(cookie, 'Shelter')

    const full = await createGear(cookie, {
      name: 'Tent',
      description: '2-person',
      weightGrams: 1250,
      categoryId: catId,
      cost: 129.99,
      purchaseDate: '2024-06-15',
      status: 'needs_repair',
    })
    expect(full.description).toBe('2-person')
    expect(full.weightGrams).toBe(1250)
    expect(full.categoryId).toBe(catId)
    expect(full.cost).toBe(129.99) // dollars in, dollars out (cents inside)
    expect(full.purchaseDate).toBe('2024-06-15')
    expect(full.status).toBe('needs_repair')
    expect(full.sortOrder).toBe(0)
    // Allowlist: user_id never leaves the server.
    expect(Object.keys(full).sort()).toEqual(
      [
        'categoryId',
        'cost',
        'createdAt',
        'description',
        'id',
        'name',
        'purchaseDate',
        'sortOrder',
        'status',
        'updatedAt',
        'weightGrams',
      ].sort(),
    )

    const minimal = await createGear(cookie, { name: 'Spork' })
    expect(minimal).toMatchObject({
      description: null,
      weightGrams: 0,
      categoryId: null,
      cost: null,
      purchaseDate: null,
      status: 'active',
      sortOrder: 1, // server-assigned max+1
    })
  })

  it("creating into someone else's category is 400 (cross-parent stitching)", async () => {
    const a = await signUpVerifiedUser('gear-stitch-a@example.com', 'A')
    const b = await signUpVerifiedUser('gear-stitch-b@example.com', 'B')
    const bCat = await createCategory(b.cookie, 'Bs')
    const res = await apiRequest(a.cookie, 'POST', '/api/gear-items', {
      name: 'Sneaky',
      categoryId: bCat,
    })
    expect(res.status).toBe(400)
    expect(await listGear(a.cookie)).toHaveLength(0)
  })

  it('PATCH: partial updates, null clears, foreign category rejected', async () => {
    const { cookie } = await signUpVerifiedUser('gear-patch@example.com', 'P')
    const catId = await createCategory(cookie, 'Cook')
    const item = await createGear(cookie, {
      name: 'Stove',
      description: 'MSR',
      weightGrams: 400,
      categoryId: catId,
      cost: 55,
    })

    const renamed = await apiRequest(
      cookie,
      'PATCH',
      `/api/gear-items/${item.id}`,
      { name: 'Pocket Rocket' },
    )
    const afterRename = gearItemResponseSchema.parse(await renamed.json())
    expect(afterRename.name).toBe('Pocket Rocket')
    // Untouched fields survive a partial patch.
    expect(afterRename.description).toBe('MSR')
    expect(afterRename.weightGrams).toBe(400)
    expect(afterRename.categoryId).toBe(catId)

    const cleared = await apiRequest(
      cookie,
      'PATCH',
      `/api/gear-items/${item.id}`,
      { description: null, categoryId: null, cost: null },
    )
    const afterClear = gearItemResponseSchema.parse(await cleared.json())
    expect(afterClear.description).toBeNull()
    expect(afterClear.categoryId).toBeNull()
    expect(afterClear.cost).toBeNull()

    const other = await signUpVerifiedUser('gear-patch-b@example.com', 'B')
    const foreignCat = await createCategory(other.cookie, 'Foreign')
    const bad = await apiRequest(
      cookie,
      'PATCH',
      `/api/gear-items/${item.id}`,
      { categoryId: foreignCat },
    )
    expect(bad.status).toBe(400)

    const empty = await apiRequest(
      cookie,
      'PATCH',
      `/api/gear-items/${item.id}`,
      {},
    )
    expect(empty.status).toBe(400)

    const missing = await apiRequest(
      cookie,
      'PATCH',
      '/api/gear-items/no-such-id',
      { name: 'Ghost' },
    )
    expect(missing.status).toBe(404)
  })

  it('non-owner PATCH/DELETE are 404 and change nothing', async () => {
    const a = await signUpVerifiedUser('gear-nonown-a@example.com', 'A')
    const b = await signUpVerifiedUser('gear-nonown-b@example.com', 'B')
    const item = await createGear(a.cookie, { name: 'Quilt' })

    expect(
      (
        await apiRequest(b.cookie, 'PATCH', `/api/gear-items/${item.id}`, {
          name: 'Mine now',
        })
      ).status,
    ).toBe(404)
    expect(
      (await apiRequest(b.cookie, 'DELETE', `/api/gear-items/${item.id}`))
        .status,
    ).toBe(404)

    const after = await listGear(a.cookie)
    expect(after).toHaveLength(1)
    expect(after[0]?.name).toBe('Quilt')
  })

  it('bulk-delete is all-or-nothing: one foreign id leaves every row intact', async () => {
    const a = await signUpVerifiedUser('gear-bulkdel-a@example.com', 'A')
    const b = await signUpVerifiedUser('gear-bulkdel-b@example.com', 'B')
    const one = await createGear(a.cookie, { name: 'One' })
    const two = await createGear(a.cookie, { name: 'Two' })
    const foreign = await createGear(b.cookie, { name: 'Foreign' })

    const mixed = await apiRequest(a.cookie, 'POST', '/api/gear-items/bulk-delete', {
      ids: [one.id, two.id, foreign.id],
    })
    expect(mixed.status).toBe(404)
    expect(await listGear(a.cookie)).toHaveLength(2)
    expect(await listGear(b.cookie)).toHaveLength(1)

    const clean = await apiRequest(a.cookie, 'POST', '/api/gear-items/bulk-delete', {
      ids: [one.id, two.id],
    })
    expect(clean.status).toBe(204)
    expect(await listGear(a.cookie)).toHaveLength(0)
  })

  it('bulk-move: own target works, null uncategorizes, foreign anything rejected', async () => {
    const a = await signUpVerifiedUser('gear-bulkmove-a@example.com', 'A')
    const b = await signUpVerifiedUser('gear-bulkmove-b@example.com', 'B')
    const catId = await createCategory(a.cookie, 'Target')
    const bCat = await createCategory(b.cookie, 'Bs')
    const one = await createGear(a.cookie, { name: 'One' })
    const two = await createGear(a.cookie, { name: 'Two' })
    const foreign = await createGear(b.cookie, { name: 'Foreign' })

    const move = await apiRequest(a.cookie, 'POST', '/api/gear-items/bulk-move', {
      ids: [one.id, two.id],
      categoryId: catId,
    })
    expect(move.status).toBe(204)
    expect((await listGear(a.cookie)).map((g) => g.categoryId)).toEqual([
      catId,
      catId,
    ])

    const toForeignCat = await apiRequest(
      a.cookie,
      'POST',
      '/api/gear-items/bulk-move',
      { ids: [one.id], categoryId: bCat },
    )
    expect(toForeignCat.status).toBe(400)

    const withForeignItem = await apiRequest(
      a.cookie,
      'POST',
      '/api/gear-items/bulk-move',
      { ids: [one.id, foreign.id], categoryId: null },
    )
    expect(withForeignItem.status).toBe(404)
    // Nothing moved on either failure.
    expect((await listGear(a.cookie)).map((g) => g.categoryId)).toEqual([
      catId,
      catId,
    ])
    expect((await listGear(b.cookie))[0]?.categoryId).toBeNull()

    const uncat = await apiRequest(a.cookie, 'POST', '/api/gear-items/bulk-move', {
      ids: [one.id, two.id],
      categoryId: null,
    })
    expect(uncat.status).toBe(204)
    expect((await listGear(a.cookie)).map((g) => g.categoryId)).toEqual([
      null,
      null,
    ])
  })

  it('reorder is all-or-nothing (mirrors the categories contract)', async () => {
    const a = await signUpVerifiedUser('gear-reorder-a@example.com', 'A')
    const b = await signUpVerifiedUser('gear-reorder-b@example.com', 'B')
    const one = await createGear(a.cookie, { name: 'One' })
    const two = await createGear(a.cookie, { name: 'Two' })
    const foreign = await createGear(b.cookie, { name: 'Foreign' })

    const bad = await apiRequest(a.cookie, 'PUT', '/api/gear-items/order', [
      { id: one.id, sortOrder: 5 },
      { id: foreign.id, sortOrder: 6 },
    ])
    expect(bad.status).toBe(404)
    expect((await listGear(a.cookie)).map((g) => g.sortOrder)).toEqual([0, 1])

    const good = await apiRequest(a.cookie, 'PUT', '/api/gear-items/order', [
      { id: two.id, sortOrder: 0 },
      { id: one.id, sortOrder: 1 },
    ])
    expect(good.status).toBe(204)
    expect((await listGear(a.cookie)).map((g) => g.name)).toEqual([
      'Two',
      'One',
    ])
  })

  it('the 500 cap: friendly 422 from the API, trigger backstop on raw inserts', async () => {
    const { cookie } = await signUpVerifiedUser('gear-cap@example.com', 'Cap')
    const userId = await userIdFor(cookie)

    // Seed 499 rows directly (the API path would be 499 round trips).
    const values = Array.from({ length: 499 }, (_, i) => {
      return `('seed-${i}', '${userId}', 'Seed item ${i}', 0, 'active', ${i}, 0, 0)`
    }).join(',')
    await env.DB.prepare(
      `insert into gear_items (id, user_id, name, weight_grams, status, sort_order, created_at, updated_at) values ${values}`,
    ).run()

    // 500th via the API is fine...
    const at500 = await apiRequest(cookie, 'POST', '/api/gear-items', {
      name: 'The 500th',
    })
    expect(at500.status).toBe(201)

    // ...the 501st gets a friendly 422: the DB trigger fires and the repo
    // maps its error (single enforcement point, no read-then-insert race).
    const over = await apiRequest(cookie, 'POST', '/api/gear-items', {
      name: 'One too many',
    })
    expect(over.status).toBe(422)

    // ...and the DB trigger backstops writes that bypass the repo.
    await expect(
      env.DB.prepare(
        `insert into gear_items (id, user_id, name, weight_grams, status, sort_order, created_at, updated_at) values ('bypass', '${userId}', 'Bypass', 0, 'active', 0, 0, 0)`,
      ).run(),
    ).rejects.toThrow(/cap/)
  })

  it('isCapError matches only the root SQLite trigger error, never wrapper params', () => {
    // Drizzle's wrapper message embeds the bound params, so an item
    // literally NAMED like the trigger message must not turn an unrelated
    // failure (here: the composite-FK race) into a false 422.
    const fkRoot = new Error(
      'FOREIGN KEY constraint failed: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_FOREIGNKEY)',
    )
    const fkD1 = new Error('D1_ERROR: FOREIGN KEY constraint failed', {
      cause: fkRoot,
    })
    const fkWrapper = new Error(
      'Failed query: insert into "gear_items" ... params: abc,gear item cap exceeded (500 per user): SQLITE_CONSTRAINT_TRIGGER,0,active',
      { cause: fkD1 },
    )
    expect(isCapError(fkWrapper)).toBe(false)

    // The real trigger shape (pinned live by the 501st-item test above).
    const capRoot = new Error(
      'gear item cap exceeded (500 per user): SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_TRIGGER)',
    )
    const capD1 = new Error(`D1_ERROR: ${capRoot.message}`, { cause: capRoot })
    const capWrapper = new Error('Failed query: insert into "gear_items" ...', {
      cause: capD1,
    })
    expect(isCapError(capWrapper)).toBe(true)
    expect(isCapError(new Error('unrelated'))).toBe(false)
    expect(isCapError(null)).toBe(false)
  })

  it('validation: bounds, dates, money, status, oversized arrays', async () => {
    const { cookie } = await signUpVerifiedUser('gear-valid@example.com', 'V')
    for (const body of [
      { name: '' },
      { name: 'x'.repeat(257) },
      { name: 'ok', weightGrams: -1 },
      { name: 'ok', weightGrams: 100001 },
      { name: 'ok', weightGrams: 12.5 },
      { name: 'ok', cost: -1 },
      { name: 'ok', cost: 12.999 }, // 3 decimal places
      { name: 'ok', cost: 100_000_000 },
      { name: 'ok', purchaseDate: '2026-02-30' }, // not a real date
      { name: 'ok', purchaseDate: '15-06-2024' },
      { name: 'ok', status: 'broken' },
      { name: 'ok', description: '' },
      { name: 'ok', unknownField: 1 },
    ]) {
      const res = await apiRequest(cookie, 'POST', '/api/gear-items', body)
      expect(res.status, JSON.stringify(body)).toBe(400)
    }

    const tooMany = await apiRequest(cookie, 'PUT', '/api/gear-items/order',
      Array.from({ length: 501 }, (_, i) => ({ id: `id-${i}`, sortOrder: i })),
    )
    expect(tooMany.status).toBe(400)

    const dupes = await apiRequest(cookie, 'POST', '/api/gear-items/bulk-delete', {
      ids: ['same', 'same'],
    })
    expect(dupes.status).toBe(400)
  })
})
