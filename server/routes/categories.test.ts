import { testDb } from '../test/node-env'
import { describe, expect, it } from 'vitest'
import {
  CATEGORY_CAP,
  categoryResponseSchema,
  reorderRequestSchema,
  type CategoryResponse,
} from '../../shared/gear'
import { apiRequest } from '../test/api-helpers'
import { signUpVerifiedUser } from '../test/auth-helpers'

async function createCategory(
  cookie: string,
  name: string,
): Promise<CategoryResponse> {
  const res = await apiRequest(cookie, 'POST', '/api/categories', { name })
  if (res.status !== 201) throw new Error(`create failed: ${res.status}`)
  return categoryResponseSchema.parse(await res.json())
}

async function listCategories(cookie: string): Promise<CategoryResponse[]> {
  const res = await apiRequest(cookie, 'GET', '/api/categories')
  return categoryResponseSchema.array().parse(await res.json())
}

describe('/api/categories authorization matrix', () => {
  it('owner CRUD round-trip: server-assigned sort order, DTO allowlist', async () => {
    const { cookie } = await signUpVerifiedUser('cat-crud@example.com', 'C')
    const shelter = await createCategory(cookie, 'Shelter')
    const cooking = await createCategory(cookie, 'Cooking')
    expect(shelter.sortOrder).toBe(0)
    expect(cooking.sortOrder).toBe(1)
    // Allowlist: nothing beyond the DTO's keys leaves the server
    // (user_id in particular).
    expect(Object.keys(shelter).sort()).toEqual(
      ['createdAt', 'id', 'name', 'sortOrder'].sort(),
    )

    const renamed = await apiRequest(
      cookie,
      'PATCH',
      `/api/categories/${shelter.id}`,
      { name: 'Sleep system' },
    )
    expect(renamed.status).toBe(200)
    expect(categoryResponseSchema.parse(await renamed.json()).name).toBe(
      'Sleep system',
    )

    const del = await apiRequest(
      cookie,
      'DELETE',
      `/api/categories/${cooking.id}`,
    )
    expect(del.status).toBe(204)
    expect((await listCategories(cookie)).map((c) => c.name)).toEqual([
      'Sleep system',
    ])
  })

  it("non-owner mutations are 404 and provably change nothing", async () => {
    const a = await signUpVerifiedUser('cat-owner-a@example.com', 'A')
    const b = await signUpVerifiedUser('cat-owner-b@example.com', 'B')
    const cat = await createCategory(a.cookie, 'Packs')

    const patch = await apiRequest(
      b.cookie,
      'PATCH',
      `/api/categories/${cat.id}`,
      { name: 'Stolen' },
    )
    expect(patch.status).toBe(404)
    const del = await apiRequest(b.cookie, 'DELETE', `/api/categories/${cat.id}`)
    expect(del.status).toBe(404)

    const after = await listCategories(a.cookie)
    expect(after).toHaveLength(1)
    expect(after[0]?.name).toBe('Packs')
    // B's own view is unaffected too.
    expect(await listCategories(b.cookie)).toHaveLength(0)
  })

  it('reorder applies all-or-nothing and lists follow (sortOrder, name)', async () => {
    const { cookie } = await signUpVerifiedUser('cat-reorder@example.com', 'R')
    const first = await createCategory(cookie, 'First')
    const second = await createCategory(cookie, 'Second')
    const third = await createCategory(cookie, 'Third')

    const ok = await apiRequest(cookie, 'PUT', '/api/categories/order', [
      { id: third.id, sortOrder: 0 },
      { id: first.id, sortOrder: 1 },
      { id: second.id, sortOrder: 2 },
    ])
    expect(ok.status).toBe(204)
    expect((await listCategories(cookie)).map((c) => c.name)).toEqual([
      'Third',
      'First',
      'Second',
    ])
  })

  it('reorder containing a foreign id is 404 with ZERO writes', async () => {
    const a = await signUpVerifiedUser('cat-atomic-a@example.com', 'A')
    const b = await signUpVerifiedUser('cat-atomic-b@example.com', 'B')
    const mine = await createCategory(a.cookie, 'Mine')
    const mine2 = await createCategory(a.cookie, 'Mine2')
    const theirs = await createCategory(b.cookie, 'Theirs')

    const res = await apiRequest(a.cookie, 'PUT', '/api/categories/order', [
      { id: mine.id, sortOrder: 10 },
      { id: mine2.id, sortOrder: 11 },
      { id: theirs.id, sortOrder: 12 },
    ])
    expect(res.status).toBe(404)
    // Not even the owned rows moved: all-or-nothing.
    const after = await listCategories(a.cookie)
    expect(after.map((c) => c.sortOrder)).toEqual([0, 1])
    const theirsAfter = await listCategories(b.cookie)
    expect(theirsAfter[0]?.sortOrder).toBe(0)
  })

  it('deleting a category uncategorizes its gear in the same transaction', async () => {
    const { cookie } = await signUpVerifiedUser('cat-del-gear@example.com', 'D')
    const keep = await createCategory(cookie, 'Keep')
    const doomed = await createCategory(cookie, 'Doomed')
    const inDoomed = await apiRequest(cookie, 'POST', '/api/gear-items', {
      name: 'Tent',
      categoryId: doomed.id,
    })
    expect(inDoomed.status).toBe(201)
    const inKeep = await apiRequest(cookie, 'POST', '/api/gear-items', {
      name: 'Stove',
      categoryId: keep.id,
    })
    expect(inKeep.status).toBe(201)

    const del = await apiRequest(cookie, 'DELETE', `/api/categories/${doomed.id}`)
    expect(del.status).toBe(204)

    const gear = (await (
      await apiRequest(cookie, 'GET', '/api/gear-items')
    ).json()) as { name: string; categoryId: string | null }[]
    expect(gear.find((g) => g.name === 'Tent')?.categoryId).toBeNull()
    expect(gear.find((g) => g.name === 'Stove')?.categoryId).toBe(keep.id)
  })

  it('validation: empty, oversized, and unknown-key bodies are 400', async () => {
    const { cookie } = await signUpVerifiedUser('cat-valid@example.com', 'V')
    for (const body of [
      { name: '' },
      { name: '   ' },
      { name: 'x'.repeat(129) },
      { name: 'ok', extra: true },
      {},
      null,
    ]) {
      const res = await apiRequest(cookie, 'POST', '/api/categories', body)
      expect(res.status, JSON.stringify(body)).toBe(400)
    }
  })
})

// The 0021 cap. Same three-sided shape as the other cap suites: friendly 422
// through the API, the trigger as backstop on raw writes, and the matcher
// pinned against wrapper forgery. Categories were the one user-owned table
// without a cap; growth is reachable through three doors (direct create,
// gear import, list import), so each door gets its own 422 test.
describe('the category cap (500 per user)', () => {
  // Seed the product-cap fixture in one statement with inline literals.
  async function seedRawCategories(userId: string, count: number) {
    // Ids are namespaced by user: this DB is shared across the whole file,
    // and three tests seed 499 rows each.
    const values = Array.from(
      { length: count },
      (_, i) => `('${userId}-seed-${i}', '${userId}', 'Seed ${i}', ${i}, 0)`,
    ).join(',')
    await testDb.prepare(
      `insert into categories (id, user_id, name, sort_order, created_at) values ${values}`,
    ).run()
  }

  async function userIdFor(cookie: string): Promise<string> {
    const res = await apiRequest(cookie, 'GET', '/api/me')
    return ((await res.json()) as { id: string }).id
  }

  it('friendly 422 from the API, trigger backstop on raw inserts', async () => {
    const { cookie } = await signUpVerifiedUser('cat-cap@example.com', 'Cap')
    const userId = await userIdFor(cookie)
    await seedRawCategories(userId, CATEGORY_CAP - 1)

    const atCap = await apiRequest(cookie, 'POST', '/api/categories', {
      name: 'The last one that fits',
    })
    expect(atCap.status).toBe(201)

    const over = await apiRequest(cookie, 'POST', '/api/categories', {
      name: 'One too many',
    })
    expect(over.status).toBe(422)
    expect(await over.json()).toEqual({
      error: `Category limit reached (${CATEGORY_CAP} per user)`,
    })

    await expect(
      testDb.prepare(
        `insert into categories (id, user_id, name, sort_order, created_at) values ('bypass', '${userId}', 'Bypass', 0, 0)`,
      ).run(),
    ).rejects.toThrow(/cap/)
  })

  it('gear import that would blow the cap answers 422 and rolls back atomically', async () => {
    const { cookie } = await signUpVerifiedUser('cat-cap-gi@example.com', 'CG')
    const userId = await userIdFor(cookie)
    await seedRawCategories(userId, CATEGORY_CAP - 1)

    // Two NEW categories: the first lands exactly AT the cap, the second
    // trips the trigger - which must take the whole batch with it, gear
    // included.
    const res = await apiRequest(cookie, 'POST', '/api/gear-items/import', {
      categories: [
        { tempId: 'c1', name: 'Fits' },
        { tempId: 'c2', name: 'Does not' },
      ],
      items: [
        { name: 'Tent', category: { kind: 'new', tempId: 'c1' } },
        { name: 'Tarp', category: { kind: 'new', tempId: 'c2' } },
      ],
    })
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({
      error: `Category limit reached (${CATEGORY_CAP} per user)`,
    })

    // Atomic: no category (not even the one that fit) and no gear survived.
    const cats = await testDb.prepare(
      'select count(*) as n from categories where user_id = ?',
    ).bind(userId).first<{ n: number }>()
    expect(cats?.n).toBe(CATEGORY_CAP - 1)
    const gear = await testDb.prepare(
      'select count(*) as n from gear_items where user_id = ?',
    ).bind(userId).first<{ n: number }>()
    expect(gear?.n).toBe(0)
  })

  it('list import that would blow the cap answers 422 and rolls back atomically', async () => {
    const { cookie } = await signUpVerifiedUser('cat-cap-li@example.com', 'CL')
    const userId = await userIdFor(cookie)
    await seedRawCategories(userId, CATEGORY_CAP - 1)

    const res = await apiRequest(cookie, 'POST', '/api/lists/import', {
      name: 'Imported trip',
      categories: [
        { tempId: 'c1', name: 'Fits' },
        { tempId: 'c2', name: 'Does not' },
      ],
      gear: [
        { tempId: 'g1', name: 'Tent', category: { kind: 'new', tempId: 'c1' } },
        { tempId: 'g2', name: 'Tarp', category: { kind: 'new', tempId: 'c2' } },
      ],
      items: [
        { gear: { kind: 'new', tempId: 'g1' }, sortOrder: 0 },
        { gear: { kind: 'new', tempId: 'g2' }, sortOrder: 1 },
      ],
    })
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({
      error: `Category limit reached (${CATEGORY_CAP} per user)`,
    })

    // Atomic: no list, no categories past the seed, no gear.
    const cats = await testDb.prepare(
      'select count(*) as n from categories where user_id = ?',
    ).bind(userId).first<{ n: number }>()
    expect(cats?.n).toBe(CATEGORY_CAP - 1)
    const listsLeft = await testDb.prepare(
      'select count(*) as n from lists where user_id = ?',
    ).bind(userId).first<{ n: number }>()
    expect(listsLeft?.n).toBe(0)
    const gear = await testDb.prepare(
      'select count(*) as n from gear_items where user_id = ?',
    ).bind(userId).first<{ n: number }>()
    expect(gear?.n).toBe(0)
  })
})

// Drift guards: CATEGORY_CAP is the single named source, but the trigger SQL
// and the reorder transport bound each carry their own copy of the number.
// These pin the copies to the constant so changing one alone goes red.
describe('CATEGORY_CAP stays in lockstep with its copies', () => {
  it('the live trigger uses the constant as threshold AND in its message', async () => {
    const row = await testDb.prepare(
      "select sql from sqlite_master where type='trigger' and name='categories_user_cap'",
    ).first<{ sql: string }>()
    expect(row?.sql).toContain(`>= ${CATEGORY_CAP}`)
    expect(row?.sql).toContain(`(${CATEGORY_CAP} per user)`)
  })

  it('the reorder transport can still express an ordering for a user AT the cap', async () => {
    const full = Array.from({ length: CATEGORY_CAP }, (_, i) => ({
      id: `id-${i}`,
      sortOrder: i,
    }))
    expect(reorderRequestSchema.safeParse(full).success).toBe(true)
    expect(
      reorderRequestSchema.safeParse([
        ...full,
        { id: 'one-more', sortOrder: CATEGORY_CAP },
      ]).success,
    ).toBe(false)
  })
})
