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
  return apiRequest(null, 'GET', `/api/shares/v2/${slug}`)
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
  // Both flags are retired: not on any DTO, not accepted on PATCH, columns
  // left in place because dropping one rebuilds `lists` and a rebuild
  // cascade-deletes list_items (AGENTS.md). Kept in this denylist so a
  // future projection cannot quietly reintroduce either.
  'readyChecksEnabled',
  'groupWorn',
  'status',
  'cost',
  'purchaseDate',
  'createdAt',
  'updatedAt',
  'packingLocationId',
  'packing_location_id',
  'packingLocations',
  'packing_locations',
  // How someone arranged the inside of their bags is not part of what a share
  // link publishes. Both spellings: the guard walks the RAW json, so a
  // projection that leaked the column name directly would slip past a
  // camelCase-only check.
  'packSortOrder',
  'pack_sort_order',
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

describe('GET /api/shares/v2/:slug', () => {
  it('serves a shared list to anon with the exact public allowlist', async () => {
    const { cookie } = await signUpVerifiedUser('share-owner@example.com', 'O')
    const list = await createList(cookie, 'JMT Loop')

    // Owner-ordered categories: Zeta created first (sortOrder 0) so the
    // response must follow sortOrder, not alphabetize.
    const zetaId = await createCategory(cookie, 'Zeta')
    const alphaId = await createCategory(cookie, 'Alpha')
    // A third category the list never references must stay absent.
    await createCategory(cookie, 'Unreferenced')

    // REAL food on this list, so the per-row key assertion below actually
    // executes. It used to carry a note saying the loop was vacuous "here"
    // and to see food.test.ts for the populated case - and then the key set
    // it could not check went stale (it still named `quantity` after 0024
    // replaced that with `unitCount`). An assertion that cannot fail is not
    // coverage; it is a comment that looks like a test.
    //
    // Per-meal and scheduled into two of the three lunches, so unitCount is
    // DERIVED (2) rather than equal to quantity (1). A fixture where the two
    // coincide cannot tell the right field from the wrong one.
    expect(
      (await apiRequest(cookie, 'PUT', `/api/lists/${list.id}/food/days`, { days: 3 }))
        .status,
    ).toBe(200)
    const foodPlan = (await (
      await apiRequest(cookie, 'GET', `/api/lists/${list.id}/food`)
    ).json()) as { slots: { id: string; dayNumber: number; meal: string }[] }
    const lunches = foodPlan.slots
      .filter((slot) => slot.meal === 'lunch' && slot.dayNumber <= 2)
      .map((slot) => slot.id)
    expect(lunches).toHaveLength(2)
    expect(
      (
        await apiRequest(cookie, 'POST', `/api/lists/${list.id}/food/items`, {
          name: 'Ramen',
          weightGrams: 85,
          quantity: 1,
          slotIds: lunches,
        })
      ).status,
    ).toBe(201)

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
      isDraft: true, // lists are born drafts; the share view shows the banner
    })

    // sortOrder order, only referenced categories.
    expect(body.categories.map((c) => c.name)).toEqual(['Zeta', 'Alpha'])

    expect(body.items).toHaveLength(3)
    // DOCUMENT order, and Tarp is FIRST because it was added first - even
    // though the PATCH above assigned it a packing location.
    //
    // This assertion is INVERTED from what it used to say, deliberately. It
    // used to require Tarp LAST, because a move rebased sort_order and
    // sort_order was the single list-wide sequence every surface read. That
    // made arranging your pack silently rewrite the link you had already sent
    // someone. The assertion documented the bug rather than a decision.
    //
    // A move now writes pack_sort_order, which the share projection does not
    // select and this DTO does not carry. Organizing is private; the published
    // document is the one you wrote.
    expect(body.items.map((i) => i.gear.name)).toEqual([
      'Tarp',
      'Pot',
      'Uncategorized thing',
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
    // Exact key sets on the RAW json at EVERY public level, independent of
    // the schemas: a denylist can only ban names someone thought of, and the
    // parsed DTO strips before it can testify. This is the allowlist the
    // matrix row promises, checked where stripping cannot reach.
    const rawShape = raw as {
      list: object
      categories: object[]
      items: { gear: object }[]
      food: { items: object[] }
    }
    expect(Object.keys(rawShape).toSorted()).toEqual([
      'categories',
      'food',
      'items',
      'list',
    ])
    // Food's entire public surface: rows, and each row exactly five fields.
    // The per-row key set is what carries the contract - a food row also has
    // quantity, isPerMeal, isPacked, isReady, packingLocationId, packSortOrder
    // and slot ids, and none of them may cross.
    expect(Object.keys(rawShape.food)).toEqual(['items'])
    expect(rawShape.food.items).toHaveLength(1)
    for (const foodItem of rawShape.food.items) {
      expect(Object.keys(foodItem).toSorted()).toEqual([
        'id',
        'name',
        'sortOrder',
        'unitCount',
        'weightGrams',
      ])
    }
    // The value, not just the key: 1 per lunch across 2 lunches. Asserting
    // only the key set would pass on a row that published `quantity`'s value
    // under the name `unitCount`.
    expect(rawShape.food.items[0]).toMatchObject({ name: 'Ramen', unitCount: 2 })
    expect(Object.keys(rawShape.list).toSorted()).toEqual([
      'description',
      'isDraft',
      'name',
    ])
    for (const category of rawShape.categories) {
      expect(Object.keys(category).toSorted()).toEqual(['id', 'name', 'sortOrder'])
    }
    for (const item of rawShape.items) {
      expect(Object.keys(item).toSorted()).toEqual([
        'gear',
        'gearItemId',
        'id',
        'isConsumable',
        'isWorn',
        'quantity',
        'sortOrder',
      ])
      expect(Object.keys(item.gear).toSorted()).toEqual([
        'categoryId',
        'description',
        'name',
        'weightGrams',
      ])
    }
  })

  it('reflects isDraft edits, and no longer carries the retired worn flag', async () => {
    const { cookie } = await signUpVerifiedUser('share-flags@example.com', 'F')
    const list = await createList(cookie, 'Flags')
    await setShared(cookie, list.id, true)
    const patch = await apiRequest(cookie, 'PATCH', `/api/lists/${list.id}`, {
      isDraft: false,
    })
    expect(patch.status).toBe(200)

    const raw = await (await getShare(list.slug)).json()
    const body = sharedListResponseSchema.parse(raw)
    expect(body.list.isDraft).toBe(false)
    // The exact public list shape. groupWorn used to sit here, and the share
    // really did honor it until #110 made worn grouping unconditional; after
    // that it was a field nothing read. Asserted on raw JSON so a projection
    // that puts it back fails here.
    expect(Object.keys((raw as { list: object }).list).toSorted()).toEqual([
      'description',
      'isDraft',
      'name',
    ])
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

// Unsharing flips is_shared server-side. Without a no-store policy the
// response could still be sitting in a reader's browser cache, so "I made it
// private again" was true of the server and false of anyone who already had
// the link open.
describe('share responses are never stored', () => {
  it('sends private, no-store on a served share', async () => {
    const { cookie } = await signUpVerifiedUser('nostore-hit@example.com', 'N')
    const list = await createList(cookie, 'Cached trip')
    await setShared(cookie, list.id, true)

    const res = await getShare(list.slug)

    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('private, no-store')
  })

  // The 404 too: a slug fetched before its owner shared it must not cache a
  // denial that outlives the decision to share.
  it('sends private, no-store on a 404', async () => {
    const res = await getShare('nosuchslug')

    expect(res.status).toBe(404)
    expect(res.headers.get('cache-control')).toBe('private, no-store')
  })

  // The old path is GONE, not left mounted beside the new one. Leaving it
  // would keep serving cacheable responses under the policy this change
  // exists to replace, which is the entire reason the path moved.
  it('no longer answers on the unversioned path', async () => {
    const { cookie } = await signUpVerifiedUser('oldpath@example.com', 'O')
    const list = await createList(cookie, 'Old path trip')
    await setShared(cookie, list.id, true)

    const res = await apiRequest(null, 'GET', `/api/shares/${list.slug}`)

    expect(res.status).toBe(404)
  })
})
