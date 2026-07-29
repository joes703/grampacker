import { env } from 'cloudflare:test'
import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import app from '../index'
import { createDb } from '../db'
import { listItems, packingLocations } from '../db/schema'
import { isTriggerAbort } from '../repos/db-errors'
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
  sortOrder: number
}
type LocationBody = {
  id: string
  name: string
  sortOrder: number
  containerListItemId: string | null
}

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

async function createItemContainer(
  cookie: string,
  listId: string,
  containerListItemId: string,
): Promise<LocationBody> {
  const res = await apiRequest(
    cookie,
    'POST',
    `/api/lists/${listId}/packing-locations`,
    { containerListItemId },
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
    expect(isTriggerAbort(error, marker)).toBe(true)
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

  it('promotes an owned list item using its live gear name and rejects ambiguous or foreign sources', async () => {
    const owner = await signUpVerifiedUser('packing-container-owner@example.com', 'O')
    const other = await signUpVerifiedUser('packing-container-other@example.com', 'X')
    const list = await createList(owner.cookie, 'Trip')
    const otherList = await createList(owner.cookie, 'Other trip')
    const canisterGear = await createGear(owner.cookie, 'Bear canister')
    const canister = await addItem(owner.cookie, list.id, canisterGear)
    const otherListItem = await addItem(
      owner.cookie,
      otherList.id,
      await createGear(owner.cookie, 'Other pack'),
    )
    const foreignList = await createList(other.cookie, 'Foreign trip')
    const foreignItem = await addItem(
      other.cookie,
      foreignList.id,
      await createGear(other.cookie, 'Foreign pack'),
    )
    const existingLocation = await createLocation(owner.cookie, list.id, 'Top lid')
    expect(existingLocation.sortOrder).toBe(0)

    const location = await createItemContainer(owner.cookie, list.id, canister.id)
    expect(location).toMatchObject({
      name: 'Bear canister',
      sortOrder: -1,
      containerListItemId: canister.id,
    })
    expect((await getLocations(owner.cookie, list.id)).map((entry) => entry.name)).toEqual([
      'Bear canister',
      'Top lid',
    ])

    const renameGear = await apiRequest(
      owner.cookie,
      'PATCH',
      `/api/gear-items/${canisterGear}`,
      { name: 'BV500' },
    )
    expect(renameGear.status).toBe(200)
    expect((await getLocations(owner.cookie, list.id))[0]?.name).toBe('BV500')

    for (const body of [
      {},
      { name: 'Copy', containerListItemId: canister.id },
      { containerListItemId: otherListItem.id },
      { containerListItemId: foreignItem.id },
      { containerListItemId: crypto.randomUUID() },
    ]) {
      const res = await apiRequest(
        owner.cookie,
        'POST',
        `/api/lists/${list.id}/packing-locations`,
        body,
      )
      expect(res.status).toBe(400)
    }

    const duplicate = await apiRequest(
      owner.cookie,
      'POST',
      `/api/lists/${list.id}/packing-locations`,
      { containerListItemId: canister.id },
    )
    expect(duplicate.status).toBe(409)

    const renameLocation = await apiRequest(
      owner.cookie,
      'PATCH',
      `/api/lists/${list.id}/packing-locations/${location.id}`,
      { name: 'Detached name' },
    )
    expect(renameLocation.status).toBe(409)
  })

  it('uses live container names to break equal sort-order ties', async () => {
    const { cookie } = await signUpVerifiedUser('packing-live-sort@example.com', 'S')
    const list = await createList(cookie, 'Live sort')
    const zuluGear = await createGear(cookie, 'Zulu snapshot')
    const alphaGear = await createGear(cookie, 'Alpha snapshot')
    const zuluItem = await addItem(cookie, list.id, zuluGear)
    const alphaItem = await addItem(cookie, list.id, alphaGear)
    const zuluLocation = await createItemContainer(cookie, list.id, zuluItem.id)
    const alphaLocation = await createItemContainer(cookie, list.id, alphaItem.id)

    const reorder = await apiRequest(
      cookie,
      'PUT',
      `/api/lists/${list.id}/packing-locations/order`,
      [
        { id: zuluLocation.id, sortOrder: 0 },
        { id: alphaLocation.id, sortOrder: 0 },
      ],
    )
    expect(reorder.status).toBe(204)

    expect(
      (await apiRequest(cookie, 'PATCH', `/api/gear-items/${zuluGear}`, { name: 'Alpha live' }))
        .status,
    ).toBe(200)
    expect(
      (await apiRequest(cookie, 'PATCH', `/api/gear-items/${alphaGear}`, { name: 'Zulu live' }))
        .status,
    ).toBe(200)

    expect((await getLocations(cookie, list.id)).map((location) => location.name)).toEqual([
      'Alpha live',
      'Zulu live',
    ])
  })

  it('promotes gear with a 250-character name while storing a bounded fallback snapshot', async () => {
    const { cookie } = await signUpVerifiedUser('packing-long-container@example.com', 'L')
    const list = await createList(cookie, 'Long container')
    const longName = 'x'.repeat(250)
    const gearId = await createGear(cookie, longName)
    const item = await addItem(cookie, list.id, gearId)

    const response = await apiRequest(
      cookie,
      'POST',
      `/api/lists/${list.id}/packing-locations`,
      { containerListItemId: item.id },
    )

    expect(response.status).toBe(201)
    expect((await response.json()) as LocationBody).toMatchObject({
      name: longName,
      containerListItemId: item.id,
    })

    const [stored] = await createDb(env.DB)
      .select({ name: packingLocations.name })
      .from(packingLocations)
      .where(eq(packingLocations.containerListItemId, item.id))
    expect(stored?.name).toBe(longName.slice(0, 60))
  })

  it('prevents self-containment and unassigns contents when the source item is removed', async () => {
    const { cookie } = await signUpVerifiedUser('packing-container-delete@example.com', 'O')
    const list = await createList(cookie, 'Trip')
    const canister = await addItem(
      cookie,
      list.id,
      await createGear(cookie, 'Bear canister'),
    )
    const foodBag = await addItem(
      cookie,
      list.id,
      await createGear(cookie, 'Food bag'),
    )
    const location = await createItemContainer(cookie, list.id, canister.id)

    const selfAssign = await apiRequest(
      cookie,
      'PATCH',
      `/api/lists/${list.id}/items/${canister.id}`,
      { packingLocationId: location.id },
    )
    expect(selfAssign.status).toBe(400)
    expect((await getItems(cookie, list.id)).find((item) => item.id === canister.id)?.packingLocationId)
      .toBeNull()

    const assignContents = await apiRequest(
      cookie,
      'PATCH',
      `/api/lists/${list.id}/items/${foodBag.id}`,
      { packingLocationId: location.id },
    )
    expect(assignContents.status).toBe(200)

    const removeSource = await apiRequest(
      cookie,
      'DELETE',
      `/api/lists/${list.id}/items/${canister.id}`,
    )
    expect(removeSource.status).toBe(204)
    expect(await getLocations(cookie, list.id)).toEqual([])
    expect((await getItems(cookie, list.id))).toEqual([
      expect.objectContaining({ id: foodBag.id, packingLocationId: null }),
    ])
  })

  it('allows nested item containers but rejects a cycle with zero writes', async () => {
    const { cookie } = await signUpVerifiedUser('packing-container-cycle@example.com', 'O')
    const list = await createList(cookie, 'Trip')
    const pack = await addItem(cookie, list.id, await createGear(cookie, 'Pack'))
    const canister = await addItem(
      cookie,
      list.id,
      await createGear(cookie, 'Bear canister'),
    )
    const packLocation = await createItemContainer(cookie, list.id, pack.id)
    const canisterLocation = await createItemContainer(cookie, list.id, canister.id)

    const nestCanister = await apiRequest(
      cookie,
      'PATCH',
      `/api/lists/${list.id}/items/${canister.id}`,
      { packingLocationId: packLocation.id },
    )
    expect(nestCanister.status).toBe(200)

    const createCycle = await apiRequest(
      cookie,
      'PATCH',
      `/api/lists/${list.id}/items/${pack.id}`,
      { packingLocationId: canisterLocation.id },
    )
    expect(createCycle.status).toBe(400)
    expect((await getItems(cookie, list.id)).find((item) => item.id === pack.id)?.packingLocationId)
      .toBeNull()
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

  it('sends a moved item to the bottom, and leaves rank alone when the location does not change', async () => {
    // sortOrder is ONE list-wide sequence that pack mode reads per location.
    // A move used to change the assignment and nothing else, so the row kept
    // whatever global rank it already had and surfaced at an arbitrary depth
    // of its new location. Rebasing to max+1 is what makes "it went to the
    // bottom of that bag" true.
    const { cookie } = await signUpVerifiedUser('packing-move-rank@example.com', 'O')
    const list = await createList(cookie, 'Trip')
    const location = await createLocation(cookie, list.id, 'Main')

    const first = await addItem(cookie, list.id, await createGear(cookie, 'Tarp'))
    const second = await addItem(cookie, list.id, await createGear(cookie, 'Stove'))
    const third = await addItem(cookie, list.id, await createGear(cookie, 'Bag'))
    // The FIRST item is the interesting one: it holds the lowest rank, so
    // without a rebase it would land at the TOP of the destination.
    expect(first.sortOrder).toBeLessThan(third.sortOrder)

    const moved = await apiRequest(
      cookie,
      'PATCH',
      `/api/lists/${list.id}/items/${first.id}`,
      { packingLocationId: location.id },
    )
    expect(moved.status).toBe(200)
    const movedBody = (await moved.json()) as ItemBody
    expect(movedBody.packingLocationId).toBe(location.id)
    // Exactly max+1, not merely "greater": the rank has to be statable, and
    // a looser assertion would pass for any runaway value.
    expect(movedBody.sortOrder).toBe(third.sortOrder + 1)

    // Move a second item in: it must land BELOW the one already there.
    const after = await apiRequest(
      cookie,
      'PATCH',
      `/api/lists/${list.id}/items/${second.id}`,
      { packingLocationId: location.id },
    )
    expect(((await after.json()) as ItemBody).sortOrder).toBeGreaterThan(movedBody.sortOrder)

    // A PATCH that names the SAME location is not a move. Rebasing there
    // would walk an item to the bottom of its own bag on any repeated write.
    const same = await apiRequest(
      cookie,
      'PATCH',
      `/api/lists/${list.id}/items/${first.id}`,
      { packingLocationId: location.id },
    )
    expect(((await same.json()) as ItemBody).sortOrder).toBe(movedBody.sortOrder)

    // Neither is a patch that leaves the assignment out entirely.
    const unrelated = await apiRequest(
      cookie,
      'PATCH',
      `/api/lists/${list.id}/items/${first.id}`,
      { quantity: 3 },
    )
    expect(((await unrelated.json()) as ItemBody).sortOrder).toBe(movedBody.sortOrder)

    // A REJECTED move must not move the rank either. The rebase rides in the
    // same UPDATE as the assignment, so a gate that blocks one has to block
    // both - if it ever stopped doing so, an item would drift to the bottom
    // every time someone tried an invalid destination.
    const otherList = await createList(cookie, 'Other')
    const foreign = await createLocation(cookie, otherList.id, 'Foreign')
    const rejected = await apiRequest(
      cookie,
      'PATCH',
      `/api/lists/${list.id}/items/${first.id}`,
      { packingLocationId: foreign.id },
    )
    expect(rejected.status).toBe(400)
    const afterReject = (await getItems(cookie, list.id)).find((i) => i.id === first.id)
    expect(afterReject?.packingLocationId).toBe(location.id)
    expect(afterReject?.sortOrder).toBe(movedBody.sortOrder)

    // Unassigning is a move too - back to the bottom of Unassigned.
    const unassigned = await apiRequest(
      cookie,
      'PATCH',
      `/api/lists/${list.id}/items/${first.id}`,
      { packingLocationId: null },
    )
    const unassignedBody = (await unassigned.json()) as ItemBody
    expect(unassignedBody.packingLocationId).toBeNull()
    expect(unassignedBody.sortOrder).toBeGreaterThan(movedBody.sortOrder)

    // ...and null when ALREADY unassigned is not a move. Without the
    // location comparison living inside the UPDATE, this is the case that
    // walks an item down its own list on every repeated write.
    const nullAgain = await apiRequest(
      cookie,
      'PATCH',
      `/api/lists/${list.id}/items/${first.id}`,
      { packingLocationId: null },
    )
    expect(((await nullAgain.json()) as ItemBody).sortOrder).toBe(unassignedBody.sortOrder)
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

  it('duplicates an item-backed container with both sides remapped to the copied graph', async () => {
    const { cookie } = await signUpVerifiedUser('packing-container-copy@example.com', 'O')
    const list = await createList(cookie, 'Source')
    const canisterGear = await createGear(cookie, 'Bear canister')
    const foodGear = await createGear(cookie, 'Food bag')
    const canister = await addItem(cookie, list.id, canisterGear)
    const foodBag = await addItem(cookie, list.id, foodGear)
    const location = await createItemContainer(cookie, list.id, canister.id)
    await apiRequest(cookie, 'PATCH', `/api/lists/${list.id}/items/${foodBag.id}`, {
      packingLocationId: location.id,
    })

    const duplicate = await apiRequest(cookie, 'POST', `/api/lists/${list.id}/duplicate`)
    expect(duplicate.status).toBe(201)
    const copy = (await duplicate.json()) as ListBody
    const copyItems = await getItems(cookie, copy.id)
    const copiedCanister = copyItems.find((item) => item.gearItemId === canisterGear)
    const copiedFood = copyItems.find((item) => item.gearItemId === foodGear)
    const [copiedLocation] = await getLocations(cookie, copy.id)

    expect(copiedCanister?.id).toBeDefined()
    expect(copiedCanister?.id).not.toBe(canister.id)
    expect(copiedLocation).toMatchObject({
      name: 'Bear canister',
      containerListItemId: copiedCanister?.id,
    })
    expect(copiedLocation?.id).not.toBe(location.id)
    expect(copiedFood?.packingLocationId).toBe(copiedLocation?.id)
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
    const otherListItem = await addItem(
      a.cookie,
      aOther.id,
      await createGear(a.cookie, 'A other gear'),
    )
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

    await expectTriggerAbort(
      db
        .update(packingLocations)
        .set({ containerListItemId: otherListItem.id })
        .where(eq(packingLocations.id, aLocation.id)),
      'container item does not belong to this list',
    )
    await db
      .update(listItems)
      .set({ packingLocationId: null })
      .where(eq(listItems.id, item.id))
    await expect(
      db
        .update(packingLocations)
        .set({ containerListItemId: item.id })
        .where(eq(packingLocations.id, aLocation.id)),
    ).resolves.toBeDefined()
    await expectTriggerAbort(
      db
        .update(listItems)
        .set({ packingLocationId: aLocation.id })
        .where(eq(listItems.id, item.id)),
      'container nesting cycle',
    )

    const nestedItem = await addItem(
      a.cookie,
      aList.id,
      await createGear(a.cookie, 'Nested container'),
    )
    const nestedLocation = await createItemContainer(
      a.cookie,
      aList.id,
      nestedItem.id,
    )
    await db
      .update(listItems)
      .set({ packingLocationId: aLocation.id })
      .where(eq(listItems.id, nestedItem.id))
    await expectTriggerAbort(
      db
        .update(listItems)
        .set({ packingLocationId: nestedLocation.id })
        .where(eq(listItems.id, item.id)),
      'container nesting cycle',
    )
  })
})
