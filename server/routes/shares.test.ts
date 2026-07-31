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
    cost?: number
    purchaseDate?: string
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

async function createPackingLocation(
  cookie: string,
  listId: string,
  name: string,
): Promise<string> {
  const res = await apiRequest(
    cookie,
    'POST',
    `/api/lists/${listId}/packing-locations`,
    { name },
  )
  expect(res.status).toBe(201)
  return ((await res.json()) as { id: string }).id
}

async function getShare(slug: string): Promise<Response> {
  // No cookie, no CSRF header: a plain anonymous GET, exactly what a
  // share viewer's browser sends.
  return apiRequest(null, 'GET', `/api/shares/${slug}`)
}

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
  'packingLocationId',
  'packing_location_id',
  'packingLocations',
  'packing_locations',
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
      // cost + purchaseDate are POPULATED on purpose: they are private
      // inventory metadata, and a fixture that leaves them null cannot tell
      // "the share correctly omits them" apart from "there was nothing to
      // omit". FORBIDDEN_KEYS below asserts neither key reaches the wire.
      name: 'Tarp',
      description: 'DCF 8x10',
      // Fractional on purpose: gear weight is published to anonymous viewers,
      // so the tenth has to survive the share projection too.
      weightGrams: 250.5,
      categoryId: zetaId,
      cost: 289.99,
      purchaseDate: '2024-04-15',
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
    const packingLocationId = await createPackingLocation(
      cookie,
      list.id,
      'Main bag',
    )
    const worn = await apiRequest(
      cookie,
      'PATCH',
      `/api/lists/${list.id}/items/${tarpItemId}`,
      { isWorn: true, quantity: 2, packingLocationId },
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
    // sortOrder order, and Tarp is LAST despite being added first: the PATCH
    // above assigned it a packing location, and assigning one is a move, which
    // rebases the row's rank to the end of the list (repo `nextItemSortOrder`).
    // sortOrder is one list-wide sequence, so a pack-mode move is visible here
    // too - including on the public share, which is what this asserts.
    expect(body.items.map((i) => i.gear.name)).toEqual([
      'Pot',
      'Uncategorized thing',
      'Tarp',
    ])
    const tarp = body.items.find((i) => i.gear.name === 'Tarp')!
    expect(tarp).toMatchObject({
      gearItemId: tarpId,
      quantity: 2,
      isWorn: true,
      isConsumable: false,
      gear: {
        name: 'Tarp',
        description: 'DCF 8x10',
        weightGrams: 250.5,
        categoryId: zetaId,
      },
    })
    expect(
      body.items.find((i) => i.gear.name === 'Uncategorized thing')!.gear.categoryId,
    ).toBeNull()

    // Asserted on RAW json, not the parsed DTO: zod would happily coerce a
    // truncated 250 into a valid number and the schema check would still pass.
    // Found by name rather than index: these assertions are about the payload,
    // not the ordering, and pinning them to a position made an unrelated
    // ordering change look like a precision failure.
    const rawItems = (raw as { items: { gear: { name: string; weightGrams: number } }[] }).items
    expect(rawItems.find((i) => i.gear.name === 'Tarp')!.gear.weightGrams).toBe(250.5)

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

