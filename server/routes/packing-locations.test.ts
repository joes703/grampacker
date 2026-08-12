import { env } from 'cloudflare:test'
import { and, eq, sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { PACK_RANK_MAX } from '../../shared/lists'
import app from '../index'
import { createDb } from '../db'
import {
  listItems,
  packReorderGuard,
  packingLocationDeleteState,
  packingLocations,
} from '../db/schema'
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
  packSortOrder: number
  updatedAt: string
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

  it('sends a moved item to the bottom of its new bag, and leaves the document order alone', async () => {
    // A move rebases packSortOrder - the rank WITHIN the destination bag - to
    // that cohort's max+1, which is what makes "it went to the bottom of that
    // bag" true. Without a rebase the row would keep whatever rank it had and
    // surface at an arbitrary depth of its new location.
    //
    // It must NOT touch sortOrder. That column is the document order, read by
    // List view, CSV export and the anonymous share, and a move used to rebase
    // it too - so dropping something into a bag walked it to the bottom of the
    // list you wrote and of the link you had already shared.
    const { cookie } = await signUpVerifiedUser('packing-move-rank@example.com', 'O')
    const list = await createList(cookie, 'Trip')
    const location = await createLocation(cookie, list.id, 'Main')

    const first = await addItem(cookie, list.id, await createGear(cookie, 'Tarp'))
    const second = await addItem(cookie, list.id, await createGear(cookie, 'Stove'))
    const third = await addItem(cookie, list.id, await createGear(cookie, 'Bag'))
    // The FIRST item is the interesting one: it holds the lowest rank, so
    // without a rebase it would land at the TOP of the destination.
    expect(first.packSortOrder).toBeLessThan(third.packSortOrder)
    const documentOrderBefore = first.sortOrder

    const moved = await apiRequest(
      cookie,
      'PATCH',
      `/api/lists/${list.id}/items/${first.id}`,
      { packingLocationId: location.id },
    )
    expect(moved.status).toBe(200)
    const movedBody = (await moved.json()) as ItemBody
    expect(movedBody.packingLocationId).toBe(location.id)
    // Exactly 0, and that number is the point. The destination bag is EMPTY,
    // so its cohort's max+1 is 0 - even though this row sat at rank 0 of a
    // three-item Unassigned cohort and the list's highest pack rank is 2.
    //
    // A list-wide pack sequence would have produced 3 here and looked equally
    // fine. The difference only shows later: delete a location and its
    // contents merge into Unassigned by numbers from a different bag, landing
    // interleaved. Pinning the exact value is what keeps the rank
    // cohort-scoped rather than quietly global.
    expect(movedBody.packSortOrder).toBe(0)
    // The headline of the whole change: the document order did not move.
    expect(movedBody.sortOrder).toBe(documentOrderBefore)

    // Move a second item in: it must land BELOW the one already there.
    const after = await apiRequest(
      cookie,
      'PATCH',
      `/api/lists/${list.id}/items/${second.id}`,
      { packingLocationId: location.id },
    )
    expect(((await after.json()) as ItemBody).packSortOrder).toBeGreaterThan(movedBody.packSortOrder)

    // A PATCH that names the SAME location is not a move. Rebasing there
    // would walk an item to the bottom of its own bag on any repeated write.
    const same = await apiRequest(
      cookie,
      'PATCH',
      `/api/lists/${list.id}/items/${first.id}`,
      { packingLocationId: location.id },
    )
    expect(((await same.json()) as ItemBody).packSortOrder).toBe(movedBody.packSortOrder)

    // Neither is a patch that leaves the assignment out entirely.
    const unrelated = await apiRequest(
      cookie,
      'PATCH',
      `/api/lists/${list.id}/items/${first.id}`,
      { quantity: 3 },
    )
    expect(((await unrelated.json()) as ItemBody).packSortOrder).toBe(movedBody.packSortOrder)

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
    expect(afterReject?.packSortOrder).toBe(movedBody.packSortOrder)

    // Unassigning is a move too - back to the bottom of Unassigned.
    const unassigned = await apiRequest(
      cookie,
      'PATCH',
      `/api/lists/${list.id}/items/${first.id}`,
      { packingLocationId: null },
    )
    const unassignedBody = (await unassigned.json()) as ItemBody
    expect(unassignedBody.packingLocationId).toBeNull()
    // Unassigned is its own cohort, so this compares against that cohort's
    // occupants rather than the bag it just left.
    expect(unassignedBody.packSortOrder).toBeGreaterThan(-1)

    // ...and null when ALREADY unassigned is not a move. Without the
    // location comparison living inside the UPDATE, this is the case that
    // walks an item down its own list on every repeated write.
    const nullAgain = await apiRequest(
      cookie,
      'PATCH',
      `/api/lists/${list.id}/items/${first.id}`,
      { packingLocationId: null },
    )
    expect(((await nullAgain.json()) as ItemBody).packSortOrder).toBe(unassignedBody.packSortOrder)
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

  // The child-resource fourth caller from AGENTS.md: not a stranger, but the
  // OWNER reaching a location of theirs through the WRONG list. If any verb
  // succeeds here, the ownership check has quietly degraded from "this list"
  // to "this user", and every parent-scoped guarantee in the feature is
  // decoration. All three write verbs are covered because the composite
  // predicate is per-handler - one of them getting it right proves nothing
  // about the others, which is how PATCH went uncovered until 2026-08-11.
  it('wrong-parent PATCH rejects with zero writes', async () => {
    const { cookie } = await signUpVerifiedUser('packing-parent-patch@example.com', 'O')
    const a = await createList(cookie, 'A')
    const b = await createList(cookie, 'B')
    const bLoc = await createLocation(cookie, b.id, 'B loc')

    const patch = await apiRequest(
      cookie,
      'PATCH',
      `/api/lists/${a.id}/packing-locations/${bLoc.id}`,
      { name: 'Renamed through the wrong list' },
    )
    // 404, not 403: an id the caller cannot legitimately reach through THIS
    // parent is indistinguishable from one that does not exist, and saying
    // "forbidden" would confirm it exists somewhere.
    expect(patch.status).toBe(404)

    // The write half, and it is the half that carries this test.
    //
    // Verified by mutation: drop the `listId` predicate from BOTH statements
    // in `rename` and this route still answers 404 - the final
    // `readOwnedList(listId)` cannot find the renamed row under list A, so it
    // reports not_found AFTER the UPDATE has already committed. The status
    // assertion above stays green through that; only these lines fail. A
    // status-only wrong-parent test would have proven nothing here.
    const bLocations = await getLocations(cookie, b.id)
    expect(bLocations).toHaveLength(1)
    expect(bLocations[0]).toMatchObject({ id: bLoc.id, name: 'B loc' })
    // And nothing appeared in the list it was addressed through.
    expect(await getLocations(cookie, a.id)).toHaveLength(0)
  })

  // The name-only case above cannot cover this one, and the difference is an
  // existence oracle rather than a write.
  //
  // rename() pre-reads the row, and an item-backed location short-circuits to
  // `item_backed` -> 409 BEFORE the scoped UPDATE runs. So if the parent
  // predicate were ever lost from the pre-read alone, a name-only target
  // would still 404 (the correctly scoped UPDATE matches nothing) while an
  // item-backed target answered 409 - telling a caller, through the wrong
  // list, both that the id exists and what kind of location it is. Same
  // 404 as everything else is the contract.
  it('wrong-parent PATCH on an item-backed location is 404, not the item-backed 409', async () => {
    const { cookie } = await signUpVerifiedUser('packing-parent-patch-container@example.com', 'O')
    const a = await createList(cookie, 'A')
    const b = await createList(cookie, 'B')
    const bItem = await addItem(cookie, b.id, await createGear(cookie, 'Bear canister'))
    const bContainer = await createItemContainer(cookie, b.id, bItem.id)

    const patch = await apiRequest(
      cookie,
      'PATCH',
      `/api/lists/${a.id}/packing-locations/${bContainer.id}`,
      { name: 'Renamed through the wrong list' },
    )
    expect(patch.status).toBe(404)

    // The control: addressed through its OWN list the same request is a 409,
    // so the 404 above is the parent check answering and not the route
    // rejecting item-backed renames everywhere.
    const throughOwnList = await apiRequest(
      cookie,
      'PATCH',
      `/api/lists/${b.id}/packing-locations/${bContainer.id}`,
      { name: 'Renamed through the right list' },
    )
    expect(throughOwnList.status).toBe(409)

    const bLocations = await getLocations(cookie, b.id)
    expect(bLocations[0]).toMatchObject({ id: bContainer.id, name: 'Bear canister' })
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

// The point of splitting the two orderings, tested from the outside: the two
// views must be able to disagree, and neither may write the other's column.
describe('pack ordering is independent of document ordering', () => {
  it('a pack reorder leaves List order and the public share alone', async () => {
    const { cookie } = await signUpVerifiedUser('pack-independent@example.com', 'O')
    const list = await createList(cookie, 'Trip')
    const location = await createLocation(cookie, list.id, 'Main')

    const a = await addItem(cookie, list.id, await createGear(cookie, 'Alpha'))
    const b = await addItem(cookie, list.id, await createGear(cookie, 'Bravo'))
    const c = await addItem(cookie, list.id, await createGear(cookie, 'Charlie'))
    for (const item of [a, b, c]) {
      const res = await apiRequest(
        cookie,
        'PATCH',
        `/api/lists/${list.id}/items/${item.id}`,
        { packingLocationId: location.id },
      )
      expect(res.status).toBe(200)
    }

    const share = await apiRequest(cookie, 'PATCH', `/api/lists/${list.id}`, {
      isShared: true,
    })
    expect(share.status).toBe(200)
    const slug = ((await share.json()) as { slug: string }).slug
    const documentOrder = (await getItems(cookie, list.id)).map((i) => i.id)

    // Reverse the bag. The payload is a permutation of the ranks those rows
    // already hold, which is the contract the route enforces.
    const inBag = (await getItems(cookie, list.id))
      .filter((i) => i.packingLocationId === location.id)
      .sort((x, y) => x.packSortOrder - y.packSortOrder)
    const ranks = inBag.map((i) => i.packSortOrder)
    const reversed = [...inBag].reverse()
    const reorder = await apiRequest(
      cookie,
      'PUT',
      `/api/lists/${list.id}/items/pack-order`,
      reversed.map((item, i) => ({ id: item.id, packSortOrder: ranks[i]! })),
    )
    expect(reorder.status).toBe(204)

    const after = await getItems(cookie, list.id)
    // Pack order flipped...
    expect(
      after
        .filter((i) => i.packingLocationId === location.id)
        .sort((x, y) => x.packSortOrder - y.packSortOrder)
        .map((i) => i.id),
    ).toEqual(reversed.map((i) => i.id))
    // ...and the document order did not move at all.
    expect(after.map((i) => i.id)).toEqual(documentOrder)

    // Nor did the link already sent to someone else.
    const anon = await apiRequest(null, 'GET', `/api/shares/v2/${slug}`)
    expect(anon.status).toBe(200)
    const body = (await anon.json()) as { items: { gear: { name: string } }[] }
    expect(body.items.map((i) => i.gear.name)).toEqual(['Alpha', 'Bravo', 'Charlie'])
    // And the pack rank is not published under either spelling.
    expect(JSON.stringify(body)).not.toContain('packSortOrder')
    expect(JSON.stringify(body)).not.toContain('pack_sort_order')
  })

  it('a List reorder leaves pack order alone', async () => {
    const { cookie } = await signUpVerifiedUser('list-independent@example.com', 'O')
    const list = await createList(cookie, 'Trip')
    const location = await createLocation(cookie, list.id, 'Main')
    const a = await addItem(cookie, list.id, await createGear(cookie, 'Alpha'))
    const b = await addItem(cookie, list.id, await createGear(cookie, 'Bravo'))
    for (const item of [a, b]) {
      await apiRequest(cookie, 'PATCH', `/api/lists/${list.id}/items/${item.id}`, {
        packingLocationId: location.id,
      })
    }
    const before = await getItems(cookie, list.id)
    const packBefore = new Map(before.map((i) => [i.id, i.packSortOrder]))

    const swap = await apiRequest(cookie, 'PUT', `/api/lists/${list.id}/items/order`, [
      { id: a.id, sortOrder: b.sortOrder },
      { id: b.id, sortOrder: a.sortOrder },
    ])
    expect(swap.status).toBe(204)

    for (const item of await getItems(cookie, list.id)) {
      expect(item.packSortOrder).toBe(packBefore.get(item.id))
    }
  })
})

describe('pack-order route contract', () => {
  async function bagOfTwo(email: string) {
    const { cookie } = await signUpVerifiedUser(email, 'O')
    const list = await createList(cookie, 'Trip')
    const location = await createLocation(cookie, list.id, 'Main')
    const a = await addItem(cookie, list.id, await createGear(cookie, 'Alpha'))
    const b = await addItem(cookie, list.id, await createGear(cookie, 'Bravo'))
    for (const item of [a, b]) {
      await apiRequest(cookie, 'PATCH', `/api/lists/${list.id}/items/${item.id}`, {
        packingLocationId: location.id,
      })
    }
    const inBag = (await getItems(cookie, list.id)).filter(
      (i) => i.packingLocationId === location.id,
    )
    return { cookie, list, location, inBag }
  }

  it('rejects a payload spanning two cohorts, with zero writes', async () => {
    const { cookie, list, inBag } = await bagOfTwo('pack-cohort@example.com')
    // This one stays Unassigned, so it is a different cohort.
    const loose = await addItem(cookie, list.id, await createGear(cookie, 'Loose'))
    const before = await getItems(cookie, list.id)

    const res = await apiRequest(cookie, 'PUT', `/api/lists/${list.id}/items/pack-order`, [
      { id: inBag[0]!.id, packSortOrder: 1 },
      { id: loose.id, packSortOrder: 0 },
    ])
    expect(res.status).toBe(400)
    expect(await getItems(cookie, list.id)).toEqual(before)
  })

  it('accepts collision-free minted ranks, rejects a landing on an untouched row', async () => {
    // The contract moved from exact multiset permutation to INDEX-SAFETY
    // (see pack-reorder.ts): free ranks are legal - they collide with
    // nothing and ordering is what the column means - but a payload rank
    // equal to an UNTOUCHED same-table cohort row's rank is still the write
    // the unique index would reject, and still 400s with zero writes.
    const { cookie, list, inBag } = await bagOfTwo('pack-perm@example.com')
    const minted = await apiRequest(cookie, 'PUT', `/api/lists/${list.id}/items/pack-order`, [
      { id: inBag[0]!.id, packSortOrder: 7 },
      { id: inBag[1]!.id, packSortOrder: 8 },
    ])
    expect(minted.status).toBe(204)

    const before = await getItems(cookie, list.id)
    // inBag[1] now holds 8; moving inBag[0] onto it without touching it
    // must be refused.
    const collision = await apiRequest(cookie, 'PUT', `/api/lists/${list.id}/items/pack-order`, [
      { id: inBag[0]!.id, packSortOrder: 8 },
    ])
    expect(collision.status).toBe(400)
    expect(await getItems(cookie, list.id)).toEqual(before)
  })

  it('rejects a payload naming a worn row', async () => {
    const { cookie, list, inBag } = await bagOfTwo('pack-worn@example.com')
    const worn = inBag[0]!
    await apiRequest(cookie, 'PATCH', `/api/lists/${list.id}/items/${worn.id}`, {
      isWorn: true,
    })
    const before = await getItems(cookie, list.id)

    const res = await apiRequest(cookie, 'PUT', `/api/lists/${list.id}/items/pack-order`, [
      { id: worn.id, packSortOrder: inBag[1]!.packSortOrder },
      { id: inBag[1]!.id, packSortOrder: worn.packSortOrder },
    ])
    expect(res.status).toBe(400)
    expect(await getItems(cookie, list.id)).toEqual(before)
  })

  it("404s on another user's item without writing anything", async () => {
    const { cookie, list, inBag } = await bagOfTwo('pack-foreign-a@example.com')
    const b = await signUpVerifiedUser('pack-foreign-b@example.com', 'B')
    const before = await getItems(cookie, list.id)

    const res = await apiRequest(b.cookie, 'PUT', `/api/lists/${list.id}/items/pack-order`, [
      { id: inBag[0]!.id, packSortOrder: 1 },
      { id: inBag[1]!.id, packSortOrder: 0 },
    ])
    expect(res.status).toBe(404)
    expect(await getItems(cookie, list.id)).toEqual(before)
  })

  it('does not bump updatedAt', async () => {
    const { cookie, list, inBag } = await bagOfTwo('pack-updated@example.com')
    const before = await getItems(cookie, list.id)
    const res = await apiRequest(cookie, 'PUT', `/api/lists/${list.id}/items/pack-order`, [
      { id: inBag[0]!.id, packSortOrder: inBag[1]!.packSortOrder },
      { id: inBag[1]!.id, packSortOrder: inBag[0]!.packSortOrder },
    ])
    expect(res.status).toBe(204)
    const after = await getItems(cookie, list.id)
    for (const item of after) {
      const was = before.find((i) => i.id === item.id)!
      expect(item.updatedAt).toBe(was.updatedAt)
    }
  })

  // The two-phase write exists for this: applied naively, the first UPDATE
  // would put one row on a rank its neighbour still holds and the unique
  // index would reject the whole batch.
  it('applies a permutation whose intermediate state would collide', async () => {
    const { cookie, list, inBag } = await bagOfTwo('pack-twophase@example.com')
    const [first, second] = inBag
    const res = await apiRequest(cookie, 'PUT', `/api/lists/${list.id}/items/pack-order`, [
      { id: first!.id, packSortOrder: second!.packSortOrder },
      { id: second!.id, packSortOrder: first!.packSortOrder },
    ])
    expect(res.status).toBe(204)
    const after = await getItems(cookie, list.id)
    expect(after.find((i) => i.id === first!.id)?.packSortOrder).toBe(second!.packSortOrder)
    expect(after.find((i) => i.id === second!.id)?.packSortOrder).toBe(first!.packSortOrder)
  })
})

describe('deleting a location keeps its contents together', () => {
  it('appends the orphans to Unassigned as one block, in their prior order', async () => {
    const { cookie } = await signUpVerifiedUser('pack-orphans@example.com', 'O')
    const list = await createList(cookie, 'Trip')
    const location = await createLocation(cookie, list.id, 'Main')

    // Two rows already sitting in Unassigned, so the block has to land AFTER
    // them rather than interleaving with them.
    const looseA = await addItem(cookie, list.id, await createGear(cookie, 'LooseA'))
    const looseB = await addItem(cookie, list.id, await createGear(cookie, 'LooseB'))

    const inBag = []
    for (const name of ['BagOne', 'BagTwo', 'BagThree']) {
      const item = await addItem(cookie, list.id, await createGear(cookie, name))
      await apiRequest(cookie, 'PATCH', `/api/lists/${list.id}/items/${item.id}`, {
        packingLocationId: location.id,
      })
      inBag.push(item)
    }
    const bagOrderBefore = (await getItems(cookie, list.id))
      .filter((i) => i.packingLocationId === location.id)
      .sort((x, y) => x.packSortOrder - y.packSortOrder)
      .map((i) => i.id)

    const del = await apiRequest(
      cookie,
      'DELETE',
      `/api/lists/${list.id}/packing-locations/${location.id}`,
    )
    expect(del.status).toBe(204)

    const unassigned = (await getItems(cookie, list.id))
      .filter((i) => i.packingLocationId === null)
      .sort((x, y) => x.packSortOrder - y.packSortOrder)
    // The pre-existing rows keep the top, the bag's contents follow as a
    // contiguous block, and their internal order survived.
    expect(unassigned.map((i) => i.id)).toEqual([
      looseA.id,
      looseB.id,
      ...bagOrderBefore,
    ])
    // Ranks are unique, which is what the interleaving bug destroyed.
    const ranks = unassigned.map((i) => i.packSortOrder)
    expect(new Set(ranks).size).toBe(ranks.length)
    expect(ranks.every((r) => r >= 0)).toBe(true)
  })
})

// Release 2A. The reserved scratch band, and the guard that turns a lost race
// into a 409 instead of a 204 that lies.
describe('pack-order scratch band and reorder guard (0019)', () => {
  async function bagOfThree(email: string) {
    const { cookie } = await signUpVerifiedUser(email, 'O')
    const list = await createList(cookie, 'Trip')
    const location = await createLocation(cookie, list.id, 'Main')
    for (const name of ['Alpha', 'Bravo', 'Charlie']) {
      const item = await addItem(cookie, list.id, await createGear(cookie, name))
      await apiRequest(cookie, 'PATCH', `/api/lists/${list.id}/items/${item.id}`, {
        packingLocationId: location.id,
      })
    }
    const inBag = (await getItems(cookie, list.id))
      .filter((i) => i.packingLocationId === location.id)
      .sort((x, y) => x.packSortOrder - y.packSortOrder)
    return { cookie, list, location, inBag }
  }

  const guardRows = async () =>
    createDb(env.DB).select().from(packReorderGuard)

  it('leaves the guard table empty, and a SECOND reorder still succeeds', async () => {
    // The regression this pins: the guard is keyed on list_id, so a batch that
    // forgets its own cleanup makes the NEXT reorder collide on the primary
    // key. One passing reorder proves nothing; two do.
    const { cookie, list, location, inBag } = await bagOfThree(
      'pack-guard-cleanup@example.com',
    )
    const [a, , c] = inBag as [ItemBody, ItemBody, ItemBody]

    const first = await apiRequest(cookie, 'PUT', `/api/lists/${list.id}/items/pack-order`, [
      { id: a.id, packSortOrder: c.packSortOrder },
      { id: c.id, packSortOrder: a.packSortOrder },
    ])
    expect(first.status).toBe(204)
    expect(await guardRows()).toEqual([])

    // Re-read: the first swap moved these rows, and a payload built from the
    // pre-swap snapshot is no longer a permutation of what they hold - the
    // route would (correctly) 400 it, and this test would then prove nothing
    // about the guard's cleanup.
    const after = (await getItems(cookie, list.id))
      .filter((i) => i.packingLocationId === location.id)
      .sort((x, y) => x.packSortOrder - y.packSortOrder)
    const [x, y] = after as [ItemBody, ItemBody]

    const second = await apiRequest(cookie, 'PUT', `/api/lists/${list.id}/items/pack-order`, [
      { id: x.id, packSortOrder: y.packSortOrder },
      { id: y.id, packSortOrder: x.packSortOrder },
    ])
    expect(second.status).toBe(204)
    expect(await guardRows()).toEqual([])
  })

  it('rejects a negative packSortOrder with 400, not a 500 from the trigger', async () => {
    // packSortOrder used to reuse sortOrderSchema, which allows negatives. With
    // 0019 in place anything slipping past the DTO would RAISE(ABORT) and
    // surface as a 500, so the DTO is the thing that has to say no.
    const { cookie, list, inBag } = await bagOfThree('pack-negative@example.com')
    const before = await getItems(cookie, list.id)
    const res = await apiRequest(cookie, 'PUT', `/api/lists/${list.id}/items/pack-order`, [
      { id: inBag[0]!.id, packSortOrder: -1 },
    ])
    expect(res.status).toBe(400)
    expect(await getItems(cookie, list.id)).toEqual(before)
  })

  it('rejects a rank above PACK_RANK_MAX with 400', async () => {
    const { cookie, list, inBag } = await bagOfThree('pack-overmax@example.com')
    const before = await getItems(cookie, list.id)
    const res = await apiRequest(cookie, 'PUT', `/api/lists/${list.id}/items/pack-order`, [
      { id: inBag[0]!.id, packSortOrder: PACK_RANK_MAX + 1 },
    ])
    expect(res.status).toBe(400)
    expect(await getItems(cookie, list.id)).toEqual(before)
  })

  it('refuses to INSERT a negative rank, which is what makes the guard exact', async () => {
    // The scratch range is reserved by an ASYMMETRIC pair: INSERT allows only
    // 0..PACK_RANK_MAX, UPDATE additionally allows the negatives that parking
    // needs. If INSERT were also permissive, a row could be created negative
    // and "every negative row is one of our parks" - the whole basis for
    // counting rather than checking ids - would be false.
    const { cookie, list } = await bagOfThree('pack-band-insert@example.com')
    const userId = await userIdFor(cookie)
    const db = createDb(env.DB)
    await expectTriggerAbort(
      db.insert(listItems).values({
        id: crypto.randomUUID(),
        userId,
        listId: list.id,
        gearItemId: await createGear(cookie, 'Band'),
        packSortOrder: -1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
      'pack_sort_order out of range',
    )
  })

  it('refuses to commit a rank ABOVE PACK_RANK_MAX, closing the silent-overflow hole', async () => {
    // The reason the scratch range is negative rather than a band above the
    // maximum: arrivals compute max+1 and import may legitimately create a row
    // at exactly PACK_RANK_MAX, so an ordinary move would COMMIT above it. With
    // the UPDATE trigger capped, that aborts instead of silently stranding a
    // rank the client can never submit back.
    const { cookie, inBag } = await bagOfThree('pack-overflow@example.com')
    const userId = await userIdFor(cookie)
    const db = createDb(env.DB)
    await expectTriggerAbort(
      db
        .update(listItems)
        .set({ packSortOrder: PACK_RANK_MAX + 1 })
        .where(and(eq(listItems.id, inBag[0]!.id), eq(listItems.userId, userId))),
      'pack_sort_order out of range',
    )
  })

  it('fires the guard when a park did not land, and rolls the whole batch back', async () => {
    // The defect this exists for: when a concurrent reorder rewrites the cohort
    // first, every park predicate AND every settle predicate matches zero rows.
    // Nothing violates a constraint, so nothing raises - the batch commits
    // having changed nothing and the route returns 204 claiming success.
    //
    // A route-level test cannot produce that interleaving, because the pre-read
    // and the batch both live inside one repo call. So this drives the batch
    // shape directly against real D1: park ONE row, then run the guard
    // expecting TWO. The guard must abort.
    const { cookie, list, inBag } = await bagOfThree('pack-guard-fires@example.com')
    const userId = await userIdFor(cookie)
    const db = createDb(env.DB)
    const before = await getItems(cookie, list.id)
    const [a] = inBag as [ItemBody]

    await expect(
      db.batch([
        db
          .update(listItems)
          .set({ packSortOrder: -1 })
          .where(and(eq(listItems.id, a.id), eq(listItems.userId, userId))),
        db.insert(packReorderGuard).select(
          sql`select ${list.id}, (select case when count(*) = 2 then 1 end
                from list_items
               where list_id = ${list.id} and user_id = ${userId}
                 and packing_location_id is not null
                 and pack_sort_order < 0)`,
        ),
      ]),
    ).rejects.toThrow(/NOT NULL constraint failed: _pack_reorder_guard\.ok/)

    // The whole batch rolled back: the park is gone and no guard row survived
    // to poison the next reorder.
    expect(await getItems(cookie, list.id)).toEqual(before)
    expect(await guardRows()).toEqual([])
  })
})

// Release 2A, the other half of bounding the column: what happens at the top.
describe('pack rank exhaustion is a status, not a 500', () => {
  it('answers 422 when a cohort has no rank headroom left', async () => {
    // Reachable in principle whenever a cohort's maximum is PACK_RANK_MAX,
    // because every arrival computes max+1 and 0019 refuses to commit past the
    // bound. Import used to be able to plant such a row by copying sortOrder;
    // it now assigns dense ranks, so this is forced directly instead.
    const { cookie } = await signUpVerifiedUser('pack-exhausted@example.com', 'O')
    const list = await createList(cookie, 'Trip')
    const userId = await userIdFor(cookie)
    const seed = await addItem(cookie, list.id, await createGear(cookie, 'Seed'))
    await createDb(env.DB)
      .update(listItems)
      .set({ packSortOrder: PACK_RANK_MAX })
      .where(and(eq(listItems.id, seed.id), eq(listItems.userId, userId)))

    const res = await apiRequest(cookie, 'POST', `/api/lists/${list.id}/items`, {
      gearItemId: await createGear(cookie, 'Next'),
    })
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({
      error: expect.stringContaining('run out of ordering space'),
    })
  })

  it('imports assign DENSE pack ranks, so a gapped file cannot exhaust the space', async () => {
    // The reachability fix. sortOrder keeps the file's gaps (old-repo parity);
    // pack rank must not, or one row near PACK_RANK_MAX would permanently wedge
    // the list.
    const { cookie } = await signUpVerifiedUser('pack-import-dense@example.com', 'O')
    const res = await apiRequest(cookie, 'POST', '/api/lists/import', {
      name: 'Imported',
      categories: [],
      gear: [
        { tempId: 'g1', name: 'Alpha', weightGrams: 1 },
        { tempId: 'g2', name: 'Bravo', weightGrams: 1 },
      ],
      items: [
        { gear: { kind: 'new', tempId: 'g1' }, sortOrder: 0 },
        { gear: { kind: 'new', tempId: 'g2' }, sortOrder: PACK_RANK_MAX },
      ],
    })
    expect(res.status).toBe(201)
    const listId = ((await res.json()) as { id: string }).id
    const items = await getItems(cookie, listId)

    expect(items.map((i) => i.sortOrder).sort((a, b) => a - b)).toEqual([0, PACK_RANK_MAX])
    // Dense, and in the file's order.
    expect(items.map((i) => i.packSortOrder).sort((a, b) => a - b)).toEqual([0, 1])

    // And the list still accepts an arrival, which is the whole point.
    const after = await apiRequest(cookie, 'POST', `/api/lists/${listId}/items`, {
      gearItemId: await createGear(cookie, 'Charlie'),
    })
    expect(after.status).toBe(201)
  })
})

describe('location deletion near the top of the rank space', () => {
  it('deletes a two-item location when Unassigned sits just below the ceiling', async () => {
    // packingLocations.remove() appends every orphan at base + i, so a cohort
    // one below PACK_RANK_MAX needs 1000000000 AND 1000000001 for two orphans -
    // and the second overflows. This is why 0019 normalizes cohorts lacking
    // LIST_ITEM_CAP of headroom rather than only those already out of range.
    // Fresh lists cannot reach that state any more, so it is forced directly.
    const { cookie } = await signUpVerifiedUser('pack-nearceiling@example.com', 'O')
    const list = await createList(cookie, 'Trip')
    const userId = await userIdFor(cookie)
    const db = createDb(env.DB)

    const loose = await addItem(cookie, list.id, await createGear(cookie, 'Loose'))
    await db
      .update(listItems)
      .set({ packSortOrder: PACK_RANK_MAX - 1 })
      .where(and(eq(listItems.id, loose.id), eq(listItems.userId, userId)))

    const location = await createLocation(cookie, list.id, 'Bag')
    for (const name of ['A', 'B']) {
      const item = await addItem(cookie, list.id, await createGear(cookie, name))
      await apiRequest(cookie, 'PATCH', `/api/lists/${list.id}/items/${item.id}`, {
        packingLocationId: location.id,
      })
    }

    const res = await apiRequest(
      cookie,
      'DELETE',
      `/api/lists/${list.id}/packing-locations/${location.id}`,
    )
    // 422 is the classified outcome; what must NEVER happen is a 500.
    expect([204, 422]).toContain(res.status)
    expect(res.status).not.toBe(500)

    if (res.status === 422) {
      expect(await res.json()).toEqual({
        error: expect.stringContaining('run out of pack ordering space'),
      })
      // And nothing was half-applied.
      expect((await getLocations(cookie, list.id)).map((l) => l.id)).toContain(
        location.id,
      )
    }
  })
})

// Release 2B: the actual P0.1 fix.
describe('deleting a list with bagged items (P0.1)', () => {
  async function collidingList(email: string) {
    // The minimal shape that reproduces it: rank 0 held in Unassigned AND rank
    // 0 held inside a bag. On delete the bagged row is SET NULL into Unassigned
    // carrying rank 0, which the partial unique index rejects.
    const { cookie } = await signUpVerifiedUser(email, 'O')
    const list = await createList(cookie, 'Trip')
    const loose = await addItem(cookie, list.id, await createGear(cookie, 'Loose'))
    const location = await createLocation(cookie, list.id, 'Bag')
    const bagged = await addItem(cookie, list.id, await createGear(cookie, 'Bagged'))
    await apiRequest(cookie, 'PATCH', `/api/lists/${list.id}/items/${bagged.id}`, {
      packingLocationId: location.id,
    })
    const items = await getItems(cookie, list.id)
    // Assert the colliding shape really exists, so this cannot pass vacuously.
    const looseRank = items.find((i) => i.id === loose.id)!.packSortOrder
    const baggedRank = items.find((i) => i.id === bagged.id)!.packSortOrder
    expect(looseRank).toBe(baggedRank)
    return { cookie, list, location, loose, bagged }
  }

  it('deletes the list instead of failing on the unique index', async () => {
    const { cookie, list } = await collidingList('p01-list-delete@example.com')
    const res = await apiRequest(cookie, 'DELETE', `/api/lists/${list.id}`)
    expect(res.status).toBe(204)
    expect((await apiRequest(cookie, 'GET', `/api/lists/${list.id}`)).status).toBe(404)
  })

  it('deletes the location and re-ranks its orphans into Unassigned', async () => {
    const { cookie, list, location, loose, bagged } = await collidingList(
      'p01-location-delete@example.com',
    )
    const res = await apiRequest(
      cookie,
      'DELETE',
      `/api/lists/${list.id}/packing-locations/${location.id}`,
    )
    expect(res.status).toBe(204)

    const after = await getItems(cookie, list.id)
    expect(after.every((i) => i.packingLocationId === null)).toBe(true)
    // Dense, distinct, and the survivor keeps its place ahead of the orphan.
    expect(after.map((i) => i.packSortOrder).sort((a, b) => a - b)).toEqual([0, 1])
    expect(after.find((i) => i.id === loose.id)!.packSortOrder).toBeLessThan(
      after.find((i) => i.id === bagged.id)!.packSortOrder,
    )
  })

  it('leaves the transient mapping table empty afterwards', async () => {
    const { cookie, list } = await collidingList('p01-transient@example.com')
    expect(
      (await apiRequest(cookie, 'DELETE', `/api/lists/${list.id}`)).status,
    ).toBe(204)
    expect(
      await createDb(env.DB).select().from(packingLocationDeleteState),
    ).toEqual([])
  })

  it('deletes an item-backed container without colliding', async () => {
    // Needs THREE rows. A two-row fixture passes without the fix, because
    // deleting the backing item frees its own rank first - so it would prove
    // nothing. Assert the pre-delete shape to keep it that way.
    const { cookie } = await signUpVerifiedUser('p01-container@example.com', 'O')
    const list = await createList(cookie, 'Trip')
    const survivor = await addItem(cookie, list.id, await createGear(cookie, 'Survivor'))
    const backing = await addItem(cookie, list.id, await createGear(cookie, 'Backing'))
    const container = await createItemContainer(cookie, list.id, backing.id)
    const content = await addItem(cookie, list.id, await createGear(cookie, 'Content'))
    await apiRequest(cookie, 'PATCH', `/api/lists/${list.id}/items/${content.id}`, {
      packingLocationId: container.id,
    })

    const before = await getItems(cookie, list.id)
    expect(
      before.filter((i) => i.packingLocationId === null).map((i) => i.id).sort(),
    ).toEqual([survivor.id, backing.id].sort())

    const res = await apiRequest(
      cookie,
      'DELETE',
      `/api/lists/${list.id}/items/${backing.id}`,
    )
    expect(res.status).toBe(204)
    const after = await getItems(cookie, list.id)
    expect(after.map((i) => i.packSortOrder).sort((a, b) => a - b)).toEqual([0, 1])
  })

})

describe('cascade delete at the schema caps', () => {
  it('deletes a list with 30 locations and 300 items without timing out', async () => {
    // Re-ranking per location rewrites the growing Unassigned cohort each time,
    // so a cascade over a list at the caps is quadratic in locations. Measured
    // at 17,430 list_items writes for ONE list, and ~1.9M for an account at 100
    // lists - past D1's 30-second query ceiling, where it would time out and
    // roll the whole delete back. The trigger now deletes doomed rows instead
    // of re-ranking them, which makes this one write per row.
    //
    // Seeded through the DB rather than the API: 330 API calls would dominate
    // the runtime and prove nothing extra.
    //
    // HONEST LIMIT: this asserts the delete SUCCEEDS at cap shape, not a write
    // budget - vitest-pool-workers gives no counter for that. The write-count
    // evidence lives in the migration comment and was measured directly.
    const { cookie } = await signUpVerifiedUser('cascade-scale@example.com', 'O')
    const list = await createList(cookie, 'Big')
    const userId = await userIdFor(cookie)
    const gearId = await createGear(cookie, 'Shared')
    const db = createDb(env.DB)
    const now = Date.now()

    const LOCATIONS = 30
    const ITEMS = 300
    // Chunked: D1 caps a query at 100 BOUND PARAMETERS, and these rows carry
    // 7 columns each, so a single 30-row insert is 210 params and fails. Same
    // reason the repos chunk their multi-row writes.
    const locationRows = Array.from({ length: LOCATIONS }, (_, k) => ({
      id: `scale-loc-${k}`,
      userId,
      listId: list.id,
      name: `Bag ${k}`,
      sortOrder: k,
      createdAt: now,
      updatedAt: now,
    }))
    for (let i = 0; i < locationRows.length; i += 10) {
      await db.insert(packingLocations).values(locationRows.slice(i, i + 10))
    }

    // Unassigned-heavy on purpose: a big destination cohort is what the old
    // shape rewrote once per location.
    const existing = (await getItems(cookie, list.id)).length
    const rows = []
    let unassigned = existing
    for (let i = 0; i < ITEMS - existing; i++) {
      const inLocation = i < LOCATIONS
      rows.push({
        id: `scale-item-${i}`,
        userId,
        listId: list.id,
        gearItemId: gearId,
        packingLocationId: inLocation ? `scale-loc-${i}` : null,
        packSortOrder: inLocation ? 0 : unassigned++,
        sortOrder: i,
        createdAt: now,
        updatedAt: now,
      })
    }
    // 7 rows, not 10. Drizzle emits EVERY column of the table - 14 here,
    // including the ones left to their defaults - so the parameter count is
    // driven by the table's width, not by how many fields this code sets.
    // 7 x 14 = 98, just under D1's 100-parameter cap. (This is the same
    // divisor bug P2.6 records against `chunkForParamCap`.)
    for (let i = 0; i < rows.length; i += 7) {
      await db.insert(listItems).values(rows.slice(i, i + 7))
    }
    expect((await getItems(cookie, list.id)).length).toBe(ITEMS)

    const res = await apiRequest(cookie, 'DELETE', `/api/lists/${list.id}`)
    expect(res.status).toBe(204)
    expect(await createDb(env.DB).select().from(packingLocationDeleteState)).toEqual([])
  })
})
