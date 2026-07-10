import { describe, expect, it } from 'vitest'
import { sharedListResponseSchema } from '../../shared/lists'
import { apiRequest } from '../test/api-helpers'
import { signUpVerifiedUser } from '../test/auth-helpers'

type ListBody = { id: string; slug: string; isShared: boolean }

async function createList(cookie: string, name: string): Promise<ListBody> {
  const res = await apiRequest(cookie, 'POST', '/api/lists', { name })
  expect(res.status).toBe(201)
  return (await res.json()) as ListBody
}

async function setShared(
  cookie: string,
  listId: string,
  isShared: boolean,
): Promise<ListBody> {
  const res = await apiRequest(cookie, 'PATCH', `/api/lists/${listId}`, {
    isShared,
  })
  expect(res.status).toBe(200)
  return (await res.json()) as ListBody
}

async function createCategory(cookie: string, name: string): Promise<string> {
  const res = await apiRequest(cookie, 'POST', '/api/categories', { name })
  expect(res.status).toBe(201)
  return ((await res.json()) as { id: string }).id
}

async function createGear(
  cookie: string,
  gear: {
    name: string
    description?: string
    weightGrams?: number
    categoryId?: string
  },
): Promise<string> {
  const res = await apiRequest(cookie, 'POST', '/api/gear-items', gear)
  expect(res.status).toBe(201)
  return ((await res.json()) as { id: string }).id
}

async function addItem(
  cookie: string,
  listId: string,
  gearItemId: string,
): Promise<string> {
  const res = await apiRequest(cookie, 'POST', `/api/lists/${listId}/items`, {
    gearItemId,
  })
  expect(res.status).toBe(201)
  return ((await res.json()) as { id: string }).id
}

async function getShare(slug: string): Promise<Response> {
  // No cookie, no CSRF header: a plain anonymous GET, exactly what a
  // share viewer's browser sends.
  return apiRequest(null, 'GET', `/api/shares/${slug}`)
}

// Every key that must never appear ANYWHERE in the public response, at
// any nesting depth. The runtime mirror of the allowlist comment in
// shared/lists.ts; a widened repo select or a spread slipping into the
// route mapping turns this red.
const FORBIDDEN_KEYS = new Set([
  'userId',
  'user_id',
  'listId',
  'list_id',
  'slug',
  'isShared',
  'isPacked',
  'isReady',
  'readyChecksEnabled',
  'status',
  'cost',
  'purchaseDate',
  'createdAt',
  'updatedAt',
])

function collectKeys(value: unknown, into: Set<string>): Set<string> {
  if (Array.isArray(value)) {
    for (const entry of value) collectKeys(entry, into)
  } else if (value !== null && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      into.add(key)
      collectKeys(nested, into)
    }
  }
  return into
}

describe('GET /api/shares/:slug', () => {
  it('serves a shared list to anon with the exact public allowlist', async () => {
    const { cookie } = await signUpVerifiedUser('share-owner@example.com', 'O')
    const list = await createList(cookie, 'JMT Loop')

    // Owner-ordered categories: Zeta created first (sortOrder 0) so the
    // response must follow sortOrder, not alphabetize.
    const zetaId = await createCategory(cookie, 'Zeta')
    const alphaId = await createCategory(cookie, 'Alpha')
    // A third category the list never references must stay absent.
    await createCategory(cookie, 'Unreferenced')

    const tarpId = await createGear(cookie, {
      name: 'Tarp',
      description: 'DCF 8x10',
      weightGrams: 250,
      categoryId: zetaId,
    })
    const potId = await createGear(cookie, {
      name: 'Pot',
      weightGrams: 120,
      categoryId: alphaId,
    })
    const mysteryId = await createGear(cookie, { name: 'Uncategorized thing' })

    const tarpItemId = await addItem(cookie, list.id, tarpId)
    await addItem(cookie, list.id, potId)
    await addItem(cookie, list.id, mysteryId)
    const worn = await apiRequest(
      cookie,
      'PATCH',
      `/api/lists/${list.id}/items/${tarpItemId}`,
      { isWorn: true, quantity: 2 },
    )
    expect(worn.status).toBe(200)

    await setShared(cookie, list.id, true)

    const res = await getShare(list.slug)
    expect(res.status).toBe(200)
    const raw: unknown = await res.json()
    const body = sharedListResponseSchema.parse(raw)

    expect(body.list).toEqual({
      name: 'JMT Loop',
      description: null,
      groupWorn: false,
      isDraft: true, // lists are born drafts; the share view shows the banner
    })

    // sortOrder order, only referenced categories.
    expect(body.categories.map((c) => c.name)).toEqual(['Zeta', 'Alpha'])

    expect(body.items).toHaveLength(3)
    expect(body.items.map((i) => i.gear.name)).toEqual([
      'Tarp',
      'Pot',
      'Uncategorized thing',
    ])
    const tarp = body.items[0]!
    expect(tarp).toMatchObject({
      gearItemId: tarpId,
      quantity: 2,
      isWorn: true,
      isConsumable: false,
      gear: {
        name: 'Tarp',
        description: 'DCF 8x10',
        weightGrams: 250,
        categoryId: zetaId,
      },
    })
    expect(body.items[2]!.gear.categoryId).toBeNull()

    // The leak guard: nothing private at any depth, and the list object
    // exposes neither its id nor its slug (the viewer already has the
    // slug; the id is an internal handle).
    const keys = collectKeys(raw, new Set())
    for (const forbidden of FORBIDDEN_KEYS) {
      expect(keys.has(forbidden), `forbidden key on the wire: ${forbidden}`).toBe(false)
    }
    expect(Object.keys(body.list).toSorted()).toEqual([
      'description',
      'groupWorn',
      'isDraft',
      'name',
    ])
  })

  it('reflects groupWorn and isDraft edits', async () => {
    const { cookie } = await signUpVerifiedUser('share-flags@example.com', 'F')
    const list = await createList(cookie, 'Flags')
    await setShared(cookie, list.id, true)
    const patch = await apiRequest(cookie, 'PATCH', `/api/lists/${list.id}`, {
      groupWorn: true,
      isDraft: false,
    })
    expect(patch.status).toBe(200)

    const body = sharedListResponseSchema.parse(await (await getShare(list.slug)).json())
    expect(body.list.groupWorn).toBe(true)
    expect(body.list.isDraft).toBe(false)
  })

  it('serves an empty shared list as empty arrays, not an error', async () => {
    const { cookie } = await signUpVerifiedUser('share-empty@example.com', 'E')
    const list = await createList(cookie, 'Empty')
    await setShared(cookie, list.id, true)

    const res = await getShare(list.slug)
    expect(res.status).toBe(200)
    const body = sharedListResponseSchema.parse(await res.json())
    expect(body.items).toEqual([])
    expect(body.categories).toEqual([])
  })

  it('404s identically for an unshared list and an unknown slug', async () => {
    const { cookie } = await signUpVerifiedUser('share-404@example.com', 'N')
    const list = await createList(cookie, 'Private')
    // isShared defaults false - never toggled on.

    const unshared = await getShare(list.slug)
    const unknown = await getShare('zzzzzz')
    expect(unshared.status).toBe(404)
    expect(unknown.status).toBe(404)
    expect(await unshared.json()).toEqual(await unknown.json())
  })

  it('unsharing kills the link without changing the slug', async () => {
    const { cookie } = await signUpVerifiedUser('share-toggle@example.com', 'T')
    const list = await createList(cookie, 'Toggle')

    const shared = await setShared(cookie, list.id, true)
    expect(shared.isShared).toBe(true)
    expect(shared.slug).toBe(list.slug)
    expect((await getShare(list.slug)).status).toBe(200)

    const unshared = await setShared(cookie, list.id, false)
    expect(unshared.isShared).toBe(false)
    expect(unshared.slug).toBe(list.slug)
    expect((await getShare(list.slug)).status).toBe(404)
  })
})

describe('PATCH /api/lists/:id isShared authorization', () => {
  it('anon cannot flip isShared', async () => {
    const { cookie } = await signUpVerifiedUser('share-anon@example.com', 'A')
    const list = await createList(cookie, 'Mine')
    const res = await apiRequest(null, 'PATCH', `/api/lists/${list.id}`, {
      isShared: true,
    })
    expect(res.status).toBe(401)
    expect((await getShare(list.slug)).status).toBe(404)
  })

  it('a non-owner cannot flip isShared (404, zero effect)', async () => {
    const owner = await signUpVerifiedUser('share-victim@example.com', 'V')
    const attacker = await signUpVerifiedUser('share-attacker@example.com', 'X')
    const list = await createList(owner.cookie, 'Victim list')

    const res = await apiRequest(
      attacker.cookie,
      'PATCH',
      `/api/lists/${list.id}`,
      { isShared: true },
    )
    expect(res.status).toBe(404)
    expect((await getShare(list.slug)).status).toBe(404)
  })
})
