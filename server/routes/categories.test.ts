import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import {
  categoryResponseSchema,
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
  it('anon requests are 401 on every route', async () => {
    for (const [method, path, body] of [
      ['GET', '/api/categories', undefined],
      ['POST', '/api/categories', { name: 'X' }],
      ['PUT', '/api/categories/order', [{ id: 'a', sortOrder: 0 }]],
      ['PATCH', '/api/categories/some-id', { name: 'X' }],
      ['DELETE', '/api/categories/some-id', undefined],
    ] as const) {
      const res = await apiRequest(null, method, path, body)
      expect(res.status, `${method} ${path}`).toBe(401)
    }
  })

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

  it('reorder of >100 categories works (D1 binds max 100 params/query)', async () => {
    // Regression: the reorder ownership precheck bound one param per id
    // via inArray (DTO allows 500), throwing an unmapped D1 error past
    // 100. It now loads the owned set with a single bound param.
    const { cookie } = await signUpVerifiedUser('cat-many@example.com', 'M')
    const meRes = await apiRequest(cookie, 'GET', '/api/me')
    const { id: userId } = (await meRes.json()) as { id: string }

    const values = Array.from({ length: 120 }, (_, i) => {
      return `('catmany-${i}', '${userId}', 'Cat ${i}', ${i}, 0)`
    }).join(',')
    await env.DB.prepare(
      `insert into categories (id, user_id, name, sort_order, created_at) values ${values}`,
    ).run()

    const res = await apiRequest(cookie, 'PUT', '/api/categories/order',
      Array.from({ length: 120 }, (_, i) => ({
        id: `catmany-${i}`,
        sortOrder: 119 - i,
      })),
    )
    expect(res.status).toBe(204)
    const after = await listCategories(cookie)
    expect(after).toHaveLength(120)
    expect(after[0]?.name).toBe('Cat 119') // reversed order applied
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
