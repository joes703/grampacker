import { env } from 'cloudflare:test'
import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import app from '../index'
import { createDb } from '../db'
import { listItems, packingLocations } from '../db/schema'
import { remapPackingLocationId } from '../repos/lists'
import { apiRequest } from '../test/api-helpers'
import { signUpVerifiedUser } from '../test/auth-helpers'

type ListBody = { id: string }
type ItemBody = {
  id: string
  gearItemId: string
  quantity: number
  isWorn: boolean
  packingLocationId: string | null
}
type LocationBody = { id: string; name: string; sortOrder: number }

async function userIdFor(cookie: string): Promise<string> {
  const res = await apiRequest(cookie, 'GET', '/api/me')
  return ((await res.json()) as { id: string }).id
}

async function createList(cookie: string, name: string): Promise<ListBody> {
  const res = await apiRequest(cookie, 'POST', '/api/lists', { name })
  expect(res.status).toBe(201)
  return (await res.json()) as ListBody
}

async function createGear(cookie: string, name: string): Promise<string> {
  const res = await apiRequest(cookie, 'POST', '/api/gear-items', { name })
  expect(res.status).toBe(201)
  return ((await res.json()) as { id: string }).id
}

async function addItem(
  cookie: string,
  listId: string,
  gearItemId: string,
): Promise<ItemBody> {
  const res = await apiRequest(cookie, 'POST', `/api/lists/${listId}/items`, {
    gearItemId,
  })
  expect(res.status).toBe(201)
  return (await res.json()) as ItemBody
}

async function getItems(cookie: string, listId: string): Promise<ItemBody[]> {
  const res = await apiRequest(cookie, 'GET', `/api/lists/${listId}/items`)
  expect(res.status).toBe(200)
  return (await res.json()) as ItemBody[]
}

async function createLocation(
  cookie: string,
  listId: string,
  name: string,
): Promise<LocationBody> {
  const res = await apiRequest(
    cookie,
    'POST',
    `/api/lists/${listId}/packing-locations`,
    { name },
  )
  expect(res.status).toBe(201)
  return (await res.json()) as LocationBody
}

async function getLocations(
  cookie: string,
  listId: string,
): Promise<LocationBody[]> {
  const res = await apiRequest(
    cookie,
    'GET',
    `/api/lists/${listId}/packing-locations`,
  )
  expect(res.status).toBe(200)
  return (await res.json()) as LocationBody[]
}

async function requestWithoutCsrf(
  cookie: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<Response> {
  const headers: Record<string, string> = {
    Cookie: cookie,
    Origin: 'http://localhost:5173',
  }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  return app.request(
    path,
    {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    env,
  )
}

async function expectTriggerAbort(
  operation: Promise<unknown>,
  marker: string,
): Promise<void> {
  try {
    await operation
    throw new Error('expected trigger abort')
  } catch (error) {
    expect(error).toBeInstanceOf(Error)
    const message = (error as Error).message
    expect(message).toContain(marker)
    expect(message).toContain('SQLITE_CONSTRAINT_TRIGGER')
  }
}

describe('/api/lists/:id/packing-locations authorization', () => {
  it('returns 401 without a session on every route shape', async () => {
    for (const [method, path, body] of [
      ['GET', '/api/lists/list/packing-locations', undefined],
      ['POST', '/api/lists/list/packing-locations', { name: 'Top' }],
      ['PATCH', '/api/lists/list/packing-locations/loc', { name: 'Top' }],
      ['DELETE', '/api/lists/list/packing-locations/loc', undefined],
      ['PUT', '/api/lists/list/packing-locations/order', [{ id: 'loc', sortOrder: 0 }]],
    ] as const) {
      const res = await apiRequest(null, method, path, body)
      expect(res.status, `${method} ${path}`).toBe(401)
    }
  })

  it('allows GET without the CSRF header but rejects every write', async () => {
    const { cookie } = await signUpVerifiedUser('packing-csrf@example.com', 'C')
    const list = await createList(cookie, 'CSRF')
    const location = await createLocation(cookie, list.id, 'Top')

    expect(
      (await requestWithoutCsrf(cookie, 'GET', `/api/lists/${list.id}/packing-locations`)).status,
    ).toBe(200)
    for (const [method, path, body] of [
      ['POST', `/api/lists/${list.id}/packing-locations`, { name: 'Side' }],
      ['PATCH', `/api/lists/${list.id}/packing-locations/${location.id}`, { name: 'Side' }],
      ['DELETE', `/api/lists/${list.id}/packing-locations/${location.id}`, undefined],
      ['PUT', `/api/lists/${list.id}/packing-locations/order`, [{ id: location.id, sortOrder: 0 }]],
    ] as const) {
      expect((await requestWithoutCsrf(cookie, method, path, body)).status).toBe(403)
    }
  })

  it('isolates cross-user CRUD and assignment with zero writes', async () => {
    const a = await signUpVerifiedUser('packing-owner-a@example.com', 'A')
    const b = await signUpVerifiedUser('packing-owner-b@example.com', 'B')
    const aList = await createList(a.cookie, 'A')
    const aLocation = await createLocation(a.cookie, aList.id, 'A loc')
    const bList = await createList(b.cookie, 'B')
    const bGear = await createGear(b.cookie, 'B gear')
    const bItem = await addItem(b.cookie, bList.id, bGear)

    for (const [method, path, body] of [
      ['GET', `/api/lists/${aList.id}/packing-locations`, undefined],
      ['POST', `/api/lists/${aList.id}/packing-locations`, { name: 'Nope' }],
      ['PATCH', `/api/lists/${aList.id}/packing-locations/${aLocation.id}`, { name: 'Nope' }],
      ['DELETE', `/api/lists/${aList.id}/packing-locations/${aLocation.id}`, undefined],
      ['PUT', `/api/lists/${aList.id}/packing-locations/order`, [{ id: aLocation.id, sortOrder: 9 }]],
    ] as const) {
      expect((await apiRequest(b.cookie, method, path, body)).status).toBe(404)
    }

    const assign = await apiRequest(
      b.cookie,
      'PATCH',
      `/api/lists/${bList.id}/items/${bItem.id}`,
      { packingLocationId: aLocation.id },
    )
    expect(assign.status).toBe(400)
    expect((await getItems(b.cookie, bList.id))[0]?.packingLocationId).toBeNull()
    expect((await getLocations(a.cookie, aList.id))[0]).toEqual(aLocation)
  })
})

describe('packing location CRUD, assignment, and integrity', () => {
  it('round-trips CRUD and reorder in sortOrder order', async () => {
    const { cookie } = await signUpVerifiedUser('packing-crud@example.com', 'O')
    const list = await createList(cookie, 'Trip')
    const top = await createLocation(cookie, list.id, 'Top')
    const side = await createLocation(cookie, list.id, 'Side')
    expect([top.sortOrder, side.sortOrder]).toEqual([0, 1])

    const rename = await apiRequest(
      cookie,
      'PATCH',
      `/api/lists/${list.id}/packing-locations/${side.id}`,
      { name: 'Hip belt' },
    )
    expect(rename.status).toBe(200)
    expect((await rename.json()) as LocationBody).toMatchObject({
      id: side.id,
      name: 'Hip belt',
    })

    const reorder = await apiRequest(
      cookie,
      'PUT',
      `/api/lists/${list.id}/packing-locations/order`,
      [
        { id: top.id, sortOrder: 5 },
        { id: side.id, sortOrder: -1 },
      ],
    )
    expect(reorder.status).toBe(204)
    expect((await getLocations(cookie, list.id)).map((l) => l.name)).toEqual([
      'Hip belt',
      'Top',
    ])
  })

  it('rejects invalid names, unknown keys, malformed order payloads, and non-UUID assignments', async () => {
    const { cookie } = await signUpVerifiedUser('packing-validation@example.com', 'V')
    const list = await createList(cookie, 'Validation')
    const location = await createLocation(cookie, list.id, 'Valid')
    const item = await addItem(cookie, list.id, await createGear(cookie, 'Gear'))

    for (const body of [
      { name: '' },
      { name: 'x'.repeat(61) },
      { name: 'Valid', userId: 'someone-else' },
    ]) {
      expect(
        (await apiRequest(cookie, 'POST', `/api/lists/${list.id}/packing-locations`, body)).status,
      ).toBe(400)
    }
    for (const body of [
      [],
      [
        { id: location.id, sortOrder: 0 },
        { id: location.id, sortOrder: 1 },
      ],
      [{ id: location.id, sortOrder: 1, userId: 'someone-else' }],
    ]) {
      expect(
        (await apiRequest(cookie, 'PUT', `/api/lists/${list.id}/packing-locations/order`, body)).status,
      ).toBe(400)
    }
    expect(
      (
        await apiRequest(
          cookie,
          'PATCH',
          `/api/lists/${list.id}/items/${item.id}`,
          { packingLocationId: 'not-a-uuid' },
        )
      ).status,
    ).toBe(400)
  })

  it('assigns, unassigns, preserves assignment across worn toggles, and leaves it untouched when omitted', async () => {
    const { cookie } = await signUpVerifiedUser('packing-assign@example.com', 'O')
    const list = await createList(cookie, 'Trip')
    const other = await createList(cookie, 'Other')
    const location = await createLocation(cookie, list.id, 'Main')
    const otherLocation = await createLocation(cookie, other.id, 'Other loc')
    const gear = await createGear(cookie, 'Tarp')
    const item = await addItem(cookie, list.id, gear)

    const assign = await apiRequest(
      cookie,
      'PATCH',
      `/api/lists/${list.id}/items/${item.id}`,
      { packingLocationId: location.id },
    )
    expect(assign.status).toBe(200)
    expect(((await assign.json()) as ItemBody).packingLocationId).toBe(location.id)

    const quantity = await apiRequest(
      cookie,
      'PATCH',
      `/api/lists/${list.id}/items/${item.id}`,
      { quantity: 2 },
    )
    expect(((await quantity.json()) as ItemBody).packingLocationId).toBe(location.id)

    for (const isWorn of [true, false]) {
      const worn = await apiRequest(
        cookie,
        'PATCH',
        `/api/lists/${list.id}/items/${item.id}`,
        { isWorn },
      )
      expect(worn.status).toBe(200)
      expect(((await worn.json()) as ItemBody).packingLocationId).toBe(location.id)
    }

    const bad = await apiRequest(
      cookie,
      'PATCH',
      `/api/lists/${list.id}/items/${item.id}`,
      { packingLocationId: otherLocation.id },
    )
    expect(bad.status).toBe(400)
    expect((await bad.json()) as { error: string }).toEqual({
      error: 'Invalid packing location',
    })
    expect((await getItems(cookie, list.id))[0]?.packingLocationId).toBe(location.id)

    const unassign = await apiRequest(
      cookie,
      'PATCH',
      `/api/lists/${list.id}/items/${item.id}`,
      { packingLocationId: null },
    )
    expect(unassign.status).toBe(200)
    expect(((await unassign.json()) as ItemBody).packingLocationId).toBeNull()

    const empty = await apiRequest(
      cookie,
      'PATCH',
      `/api/lists/${list.id}/items/${item.id}`,
      {},
    )
    expect(empty.status).toBe(400)
    const gone = await apiRequest(
      cookie,
      'PATCH',
      `/api/lists/${list.id}/items/${crypto.randomUUID()}`,
      { packingLocationId: location.id },
    )
    expect(gone.status).toBe(404)
  })

  it('deleting a location unassigns three items without deleting them; deleting an empty location is 204', async () => {
    const { cookie } = await signUpVerifiedUser('packing-delete@example.com', 'O')
    const list = await createList(cookie, 'Trip')
    const full = await createLocation(cookie, list.id, 'Full')
    const empty = await createLocation(cookie, list.id, 'Empty')
    for (let i = 0; i < 3; i++) {
      const item = await addItem(cookie, list.id, await createGear(cookie, `Gear ${i}`))
      const assign = await apiRequest(
        cookie,
        'PATCH',
        `/api/lists/${list.id}/items/${item.id}`,
        { packingLocationId: full.id },
      )
      expect(assign.status).toBe(200)
    }

    expect(
      (await apiRequest(cookie, 'DELETE', `/api/lists/${list.id}/packing-locations/${full.id}`)).status,
    ).toBe(204)
    const items = await getItems(cookie, list.id)
    expect(items).toHaveLength(3)
    expect(items.every((item) => item.packingLocationId === null)).toBe(true)
    expect(
      (await apiRequest(cookie, 'DELETE', `/api/lists/${list.id}/packing-locations/${empty.id}`)).status,
    ).toBe(204)
  })

  it('wrong-parent delete and reorder reject with zero writes', async () => {
    const { cookie } = await signUpVerifiedUser('packing-parent@example.com', 'O')
    const a = await createList(cookie, 'A')
    const b = await createList(cookie, 'B')
    const aLoc = await createLocation(cookie, a.id, 'A loc')
    const bLoc = await createLocation(cookie, b.id, 'B loc')
    const item = await addItem(cookie, a.id, await createGear(cookie, 'Gear'))
    await apiRequest(cookie, 'PATCH', `/api/lists/${a.id}/items/${item.id}`, {
      packingLocationId: aLoc.id,
    })

    const del = await apiRequest(
      cookie,
      'DELETE',
      `/api/lists/${a.id}/packing-locations/${bLoc.id}`,
    )
    expect(del.status).toBe(404)
    expect((await getItems(cookie, a.id))[0]).toMatchObject({
      id: item.id,
      packingLocationId: aLoc.id,
    })

    const reorder = await apiRequest(
      cookie,
      'PUT',
      `/api/lists/${a.id}/packing-locations/order`,
      [{ id: bLoc.id, sortOrder: 99 }],
    )
    expect(reorder.status).toBe(404)
    expect((await getLocations(cookie, b.id))[0]?.sortOrder).toBe(0)
  })

  it('maps the 31st location to a friendly 422', async () => {
    const { cookie } = await signUpVerifiedUser('packing-cap@example.com', 'O')
    const list = await createList(cookie, 'Cap')
    for (let i = 0; i < 30; i++) await createLocation(cookie, list.id, `L${i}`)
    const over = await apiRequest(
      cookie,
      'POST',
      `/api/lists/${list.id}/packing-locations`,
      { name: 'Too many' },
    )
    expect(over.status).toBe(422)
    expect(await over.json()).toEqual({
      error: 'Packing location limit reached (30 per list)',
    })
  })

  it('cascades locations on list delete and duplicates locations with remapped assignments', async () => {
    const { cookie } = await signUpVerifiedUser('packing-copy@example.com', 'O')
    const list = await createList(cookie, 'Source')
    const location = await createLocation(cookie, list.id, 'Canister')
    const item = await addItem(cookie, list.id, await createGear(cookie, 'Food bag'))
    await apiRequest(cookie, 'PATCH', `/api/lists/${list.id}/items/${item.id}`, {
      packingLocationId: location.id,
    })

    const duplicate = await apiRequest(cookie, 'POST', `/api/lists/${list.id}/duplicate`)
    expect(duplicate.status).toBe(201)
    const copy = (await duplicate.json()) as ListBody
    const copyLocations = await getLocations(cookie, copy.id)
    expect(copyLocations).toHaveLength(1)
    expect(copyLocations[0]).toMatchObject({ name: 'Canister', sortOrder: 0 })
    expect(copyLocations[0]?.id).not.toBe(location.id)
    expect((await getItems(cookie, copy.id))[0]?.packingLocationId).toBe(
      copyLocations[0]?.id,
    )
    expect(remapPackingLocationId(location.id, new Map())).toBeNull()
    expect((await apiRequest(cookie, 'DELETE', `/api/lists/${list.id}`)).status).toBe(204)
    const db = createDb(env.DB)
    expect(
      await db
        .select({ id: packingLocations.id })
        .from(packingLocations)
        .where(eq(packingLocations.listId, list.id)),
    ).toEqual([])
  })
})

describe('packing location database triggers', () => {
  it('enforces child same-list/owner and parent immutability while allowing valid assignments', async () => {
    const a = await signUpVerifiedUser('packing-trigger-a@example.com', 'A')
    const b = await signUpVerifiedUser('packing-trigger-b@example.com', 'B')
    const aUserId = await userIdFor(a.cookie)
    const bUserId = await userIdFor(b.cookie)
    const aList = await createList(a.cookie, 'A')
    const aOther = await createList(a.cookie, 'A other')
    const bList = await createList(b.cookie, 'B')
    const aLocation = await createLocation(a.cookie, aList.id, 'A loc')
    const otherLocation = await createLocation(a.cookie, aOther.id, 'Other loc')
    const aGear = await createGear(a.cookie, 'A gear')
    const item = await addItem(a.cookie, aList.id, aGear)
    const db = createDb(env.DB)

    await expectTriggerAbort(
      db.insert(listItems).values({
        id: crypto.randomUUID(),
        userId: aUserId,
        listId: aList.id,
        gearItemId: aGear,
        packingLocationId: otherLocation.id,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
      'packing location does not belong to this list',
    )

    await expect(
      db
        .update(listItems)
        .set({ packingLocationId: aLocation.id })
        .where(eq(listItems.id, item.id)),
    ).resolves.toBeDefined()
    for (const set of [
      { packingLocationId: otherLocation.id },
      { listId: aOther.id },
      { userId: bUserId },
    ]) {
      await expectTriggerAbort(
        db.update(listItems).set(set).where(eq(listItems.id, item.id)),
        'packing location does not belong to this list',
      )
    }

    for (const set of [{ listId: bList.id }, { userId: bUserId }]) {
      await expectTriggerAbort(
        db
          .update(packingLocations)
          .set(set)
          .where(
            and(
              eq(packingLocations.id, aLocation.id),
              eq(packingLocations.userId, aUserId),
            ),
          ),
        'packing location cannot change list or owner',
      )
    }
  })
})
