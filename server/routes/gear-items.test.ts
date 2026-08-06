import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import {
  categoryResponseSchema,
  gearItemResponseSchema,
  importGearResponseSchema,
  type CategoryResponse,
  type GearItemResponse,
  importGearRequestSchema,
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

async function listCategories(cookie: string): Promise<CategoryResponse[]> {
  const res = await apiRequest(cookie, 'GET', '/api/categories')
  return categoryResponseSchema.array().parse(await res.json())
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
      ['POST', '/api/gear-items/import', { categories: [], items: [{ name: 'X' }] }],
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

  it('import: categories + items land atomically with appended sort orders', async () => {
    const { cookie } = await signUpVerifiedUser('gear-import@example.com', 'I')
    const shelterId = await createCategory(cookie, 'Shelter')
    await createGear(cookie, { name: 'Existing tent', categoryId: shelterId })

    const res = await apiRequest(cookie, 'POST', '/api/gear-items/import', {
      categories: [
        { tempId: 'new-0', name: 'Cook' },
        { tempId: 'new-1', name: 'Sleep' },
      ],
      items: [
        {
          name: 'Stove',
          description: 'Canister top',
          weightGrams: 85,
          cost: 49.95,
          purchaseDate: '2025-03-01',
          category: { kind: 'new', tempId: 'new-0' },
        },
        {
          name: 'Quilt',
          description: null,
          weightGrams: 620,
          cost: null,
          purchaseDate: null,
          category: { kind: 'new', tempId: 'new-1' },
        },
        {
          name: 'Stakes',
          weightGrams: 60,
          category: { kind: 'existing', id: shelterId },
        },
        { name: 'Mystery widget', category: null },
      ],
    })
    expect(res.status).toBe(201)
    expect(importGearResponseSchema.parse(await res.json())).toEqual({
      createdCategories: 2,
      createdItems: 4,
    })

    // New categories exist, appended past the existing max sort order.
    const cats = await listCategories(cookie)
    expect(cats.map((c) => [c.name, c.sortOrder])).toEqual([
      ['Shelter', 0],
      ['Cook', 1],
      ['Sleep', 2],
    ])
    const cookId = cats.find((c) => c.name === 'Cook')?.id
    const sleepId = cats.find((c) => c.name === 'Sleep')?.id

    // Items appended contiguously past the pre-import max, tempIds
    // resolved to the real category ids, status always the default.
    const gear = await listGear(cookie)
    expect(gear.map((g) => [g.name, g.sortOrder, g.categoryId])).toEqual([
      ['Existing tent', 0, shelterId],
      ['Stove', 1, cookId],
      ['Quilt', 2, sleepId],
      ['Stakes', 3, shelterId],
      ['Mystery widget', 4, null],
    ])
    const stove = gear.find((g) => g.name === 'Stove')
    expect(stove).toMatchObject({
      description: 'Canister top',
      weightGrams: 85,
      cost: 49.95, // dollars in, dollars out (cents inside)
      purchaseDate: '2025-03-01',
      status: 'active',
    })
  })

  it("import referencing someone else's category is 400 with zero writes", async () => {
    const a = await signUpVerifiedUser('gear-import-a@example.com', 'A')
    const b = await signUpVerifiedUser('gear-import-b@example.com', 'B')
    const bCat = await createCategory(b.cookie, 'Bs')

    const res = await apiRequest(a.cookie, 'POST', '/api/gear-items/import', {
      categories: [{ tempId: 'new-0', name: 'Innocent' }],
      items: [
        { name: 'Fine', category: { kind: 'new', tempId: 'new-0' } },
        { name: 'Sneaky', category: { kind: 'existing', id: bCat } },
      ],
    })
    expect(res.status).toBe(400)
    // The valid new category must not survive the rejected import.
    expect(await listCategories(a.cookie)).toHaveLength(0)
    expect(await listGear(a.cookie)).toHaveLength(0)
  })

  it('import over the cap rolls back the WHOLE batch, new categories included', async () => {
    const { cookie } = await signUpVerifiedUser('gear-import-cap@example.com', 'C')
    const userId = await userIdFor(cookie)

    // Seed 499 rows directly (the API path would be 499 round trips).
    const values = Array.from({ length: 499 }, (_, i) => {
      return `('capseed-${i}', '${userId}', 'Seed item ${i}', 0, 'active', ${i}, 0, 0)`
    }).join(',')
    await env.DB.prepare(
      `insert into gear_items (id, user_id, name, weight_grams, status, sort_order, created_at, updated_at) values ${values}`,
    ).run()

    // 499 existing + 2 imported = 501: the trigger aborts the batch. The
    // old app created categories before gear non-atomically and orphaned
    // them on exactly this failure; here the category rolls back too.
    const res = await apiRequest(cookie, 'POST', '/api/gear-items/import', {
      categories: [{ tempId: 'new-0', name: 'Doomed' }],
      items: [
        { name: 'Fits', category: { kind: 'new', tempId: 'new-0' } },
        { name: 'One too many', category: null },
      ],
    })
    expect(res.status).toBe(422)
    expect(await listCategories(cookie)).toHaveLength(0)
    expect(await listGear(cookie)).toHaveLength(499)
  })

  it('import referencing >100 distinct existing categories works (D1 binds max 100 params/query)', async () => {
    // Regression (Codex finding, PR #26): the ownership precheck used one
    // inArray(...) over every referenced category id, which exceeds D1's
    // 100-bound-parameters-per-query limit and blew up a valid import as
    // an unmapped 500. The check now loads the user's owned ids with a
    // single bound param and verifies membership in JS.
    const { cookie } = await signUpVerifiedUser('gear-import-many@example.com', 'M')
    const userId = await userIdFor(cookie)

    // Seed 120 categories directly (the API path would be 120 round trips).
    const values = Array.from({ length: 120 }, (_, i) => {
      return `('manycat-${i}', '${userId}', 'Category ${i}', ${i}, 0)`
    }).join(',')
    await env.DB.prepare(
      `insert into categories (id, user_id, name, sort_order, created_at) values ${values}`,
    ).run()

    const res = await apiRequest(cookie, 'POST', '/api/gear-items/import', {
      categories: [],
      items: Array.from({ length: 120 }, (_, i) => ({
        name: `Item ${i}`,
        category: { kind: 'existing', id: `manycat-${i}` },
      })),
    })
    expect(res.status).toBe(201)
    expect(importGearResponseSchema.parse(await res.json())).toEqual({
      createdCategories: 0,
      createdItems: 120,
    })
    expect(await listGear(cookie)).toHaveLength(120)

    // The ownership guarantee survives the rewrite: one foreign ref among
    // many still rejects with zero writes.
    const other = await signUpVerifiedUser('gear-import-many-b@example.com', 'B')
    const foreignCat = await createCategory(other.cookie, 'Foreign')
    const bad = await apiRequest(cookie, 'POST', '/api/gear-items/import', {
      categories: [],
      items: [
        ...Array.from({ length: 110 }, (_, i) => ({
          name: `Again ${i}`,
          category: { kind: 'existing', id: `manycat-${i}` },
        })),
        { name: 'Sneaky', category: { kind: 'existing', id: foreignCat } },
      ],
    })
    expect(bad.status).toBe(400)
    expect(await listGear(cookie)).toHaveLength(120)
  })

  it('import validation: tempId wiring and bounds', async () => {
    const { cookie } = await signUpVerifiedUser('gear-import-v@example.com', 'V')
    for (const body of [
      // duplicate tempIds
      {
        categories: [
          { tempId: 'dup', name: 'A' },
          { tempId: 'dup', name: 'B' },
        ],
        items: [{ name: 'x', category: { kind: 'new', tempId: 'dup' } }],
      },
      // reference to an undeclared tempId
      {
        categories: [],
        items: [{ name: 'x', category: { kind: 'new', tempId: 'ghost' } }],
      },
      // declared category nothing references (category-spam guard)
      {
        categories: [{ tempId: 'orphan', name: 'Orphan' }],
        items: [{ name: 'x', category: null }],
      },
      // no items
      { categories: [], items: [] },
      // (well-formed OVER-CAP bodies are deliberately NOT here: since the
      // maxima became the real caps they answer the 422 cap dialect, and the
      // "gear import maxima" suite below owns those cases)
      // unknown field / bad nested shapes
      { categories: [], items: [{ name: 'x' }], extra: 1 },
      { categories: [], items: [{ name: 'x', category: { kind: 'existing' } }] },
      { categories: [{ tempId: 't', name: '' }], items: [{ name: 'x', category: { kind: 'new', tempId: 't' } }] },
      { categories: [], items: [{ name: 'x', cost: 12.999 }] },
    ]) {
      const res = await apiRequest(cookie, 'POST', '/api/gear-items/import', body)
      expect(res.status, JSON.stringify(body).slice(0, 120)).toBe(400)
    }
    expect(await listGear(cookie)).toHaveLength(0)
    expect(await listCategories(cookie)).toHaveLength(0)
  })

  it('bulk ops on >100 ids work (D1 binds max 100 params/query)', async () => {
    // Regression: ownsAllGearIds and the bulk-delete/bulk-move write
    // statements bound one param per id via inArray, so any bulk op on
    // 101+ ids (DTOs allow 500) threw an unmapped D1 error. Prechecks now
    // use owned-set membership; the writes are chunked inside one batch.
    const { cookie } = await signUpVerifiedUser('gear-bulk-many@example.com', 'M')
    const userId = await userIdFor(cookie)
    const catId = await createCategory(cookie, 'Target')

    const values = Array.from({ length: 150 }, (_, i) => {
      return `('bulkmany-${i}', '${userId}', 'Bulk item ${i}', 0, 'active', ${i}, 0, 0)`
    }).join(',')
    await env.DB.prepare(
      `insert into gear_items (id, user_id, name, weight_grams, status, sort_order, created_at, updated_at) values ${values}`,
    ).run()
    const ids = Array.from({ length: 150 }, (_, i) => `bulkmany-${i}`)

    const move = await apiRequest(cookie, 'POST', '/api/gear-items/bulk-move', {
      ids,
      categoryId: catId,
    })
    expect(move.status).toBe(204)
    expect((await listGear(cookie)).every((g) => g.categoryId === catId)).toBe(true)

    const reorder = await apiRequest(cookie, 'PUT', '/api/gear-items/order',
      ids.map((id, i) => ({ id, sortOrder: 149 - i })),
    )
    expect(reorder.status).toBe(204)

    const del = await apiRequest(cookie, 'POST', '/api/gear-items/bulk-delete', {
      ids,
    })
    expect(del.status).toBe(204)
    expect(await listGear(cookie)).toHaveLength(0)
  })

  it('fractional grams survive the write, the read back, and a PATCH', async () => {
    // The wire assertion for the DTO. Note what this does NOT prove: SQLite
    // INTEGER affinity stores a non-integral 12.4 as REAL rather than
    // truncating it, so this passes with or without migration 0013. The
    // declared-type probe in check-migration-safety.mjs is what covers the
    // column itself.
    const { cookie } = await signUpVerifiedUser('gear-fraction@example.com', 'F')

    const created = await createGear(cookie, { name: 'Stake', weightGrams: 12.4 })
    expect(created.weightGrams).toBe(12.4)

    const [listed] = await listGear(cookie)
    expect(listed?.weightGrams).toBe(12.4)

    const patched = await apiRequest(cookie, 'PATCH', `/api/gear-items/${created.id}`, {
      weightGrams: 0.1,
    })
    expect(patched.status).toBe(200)
    expect(gearItemResponseSchema.parse(await patched.json()).weightGrams).toBe(0.1)

    // A second create, to prove the first was not a one-off. The quick-add
    // route has its OWN DTO and is covered in lists.test.ts, not here.
    const second = await createGear(cookie, { name: 'Cord', weightGrams: 3.5 })
    expect(second.weightGrams).toBe(3.5)
  })

  it('validation: bounds, dates, money, status, oversized arrays', async () => {
    const { cookie } = await signUpVerifiedUser('gear-valid@example.com', 'V')
    for (const body of [
      { name: '' },
      { name: 'x'.repeat(257) },
      { name: 'ok', weightGrams: -1 },
      { name: 'ok', weightGrams: 100001 },
      { name: 'ok', weightGrams: 12.45 }, // 2 decimal places; 1 is the limit
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

// The import maxima (review P2.7): the DTO used to allow 2000 while the
// triggers abort at 500, so any oversized import was a GUARANTEED late
// failure after D1 executed 500+ statements. The bound is now the real cap,
// and the route answers it as the trigger's own 422 dialect through a
// two-stage parse - malformedness (structural OR relational) stays the
// uniform 400 even when the body is also oversized.
describe('gear import maxima match the real caps', () => {
  const item = (i: number, category: unknown = null) => ({
    name: `Item ${i}`,
    ...(category === null ? {} : { category }),
  })

  it('schema: the caps are the boundary (500 passes shape, 501 rejects)', () => {
    const at = {
      categories: [],
      items: Array.from({ length: 500 }, (_, i) => item(i)),
    }
    expect(importGearRequestSchema.safeParse(at).success).toBe(true)

    const over = {
      categories: [],
      items: Array.from({ length: 501 }, (_, i) => item(i)),
    }
    expect(importGearRequestSchema.safeParse(over).success).toBe(false)

    const overCats = {
      categories: Array.from({ length: 501 }, (_, i) => ({
        tempId: `c${i}`,
        name: `Cat ${i}`,
      })),
      items: Array.from({ length: 501 }, (_, i) =>
        item(i, { kind: 'new', tempId: `c${i}` }),
      ),
    }
    expect(importGearRequestSchema.safeParse(overCats).success).toBe(false)
  })

  it('501 well-formed items answer the gear 422 dialect, not a generic 400', async () => {
    const { cookie } = await signUpVerifiedUser('import-max-items@example.com', 'IM')
    const res = await apiRequest(cookie, 'POST', '/api/gear-items/import', {
      categories: [],
      items: Array.from({ length: 501 }, (_, i) => item(i)),
    })
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({
      error: 'Gear item limit reached (500 per user)',
    })
  })

  it('both caps blown answers the CATEGORY dialect (categories win)', async () => {
    // Every declared category must be referenced, so 501 valid categories
    // force >= 501 items - the category message is the actionable one.
    const { cookie } = await signUpVerifiedUser('import-max-cats@example.com', 'IC')
    const res = await apiRequest(cookie, 'POST', '/api/gear-items/import', {
      categories: Array.from({ length: 501 }, (_, i) => ({
        tempId: `c${i}`,
        name: `Cat ${i}`,
      })),
      items: Array.from({ length: 501 }, (_, i) =>
        item(i, { kind: 'new', tempId: `c${i}` }),
      ),
    })
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({
      error: 'Category limit reached (500 per user)',
    })
  })

  it('oversized AND malformed stays the uniform 400 - structurally or relationally', async () => {
    const { cookie } = await signUpVerifiedUser('import-max-bad@example.com', 'IB')

    // Structurally malformed at 501 entries (no name).
    const structural = await apiRequest(cookie, 'POST', '/api/gear-items/import', {
      categories: [],
      items: Array.from({ length: 501 }, () => ({ weightGrams: 1 })),
    })
    expect(structural.status).toBe(400)
    expect(await structural.json()).toEqual({ error: 'Invalid request body' })

    // Relationally malformed at 501 entries: duplicate category tempIds.
    const relational = await apiRequest(cookie, 'POST', '/api/gear-items/import', {
      categories: [
        { tempId: 'dup', name: 'A' },
        { tempId: 'dup', name: 'B' },
      ],
      items: Array.from({ length: 501 }, (_, i) =>
        item(i, { kind: 'new', tempId: 'dup' }),
      ),
    })
    expect(relational.status).toBe(400)
    expect(await relational.json()).toEqual({ error: 'Invalid request body' })
  })
})
