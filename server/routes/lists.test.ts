import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import {
  listItemResponseSchema,
  listResponseSchema,
} from '../../shared/lists'
import { apiRequest } from '../test/api-helpers'
import { signUpVerifiedUser } from '../test/auth-helpers'

async function userIdFor(cookie: string): Promise<string> {
  const res = await apiRequest(cookie, 'GET', '/api/me')
  const body = (await res.json()) as { id: string }
  return body.id
}

type ListBody = {
  id: string
  name: string
  description: string | null
  slug: string
  isShared: boolean
  groupWorn: boolean
  readyChecksEnabled: boolean
  isDraft: boolean
  sortOrder: number
  createdAt: string
  updatedAt: string
}

type ItemBody = {
  id: string
  listId: string
  gearItemId: string
  quantity: number
  isWorn: boolean
  isConsumable: boolean
  isPacked: boolean
  isReady: boolean
  sortOrder: number
  updatedAt: string
  gearItem: { id: string; name: string }
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

async function getLists(cookie: string): Promise<ListBody[]> {
  const res = await apiRequest(cookie, 'GET', '/api/lists')
  expect(res.status).toBe(200)
  return (await res.json()) as ListBody[]
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('/api/lists authorization matrix', () => {
  it('anon requests are 401 on every route', async () => {
    for (const [method, path, body] of [
      ['GET', '/api/lists', undefined],
      ['POST', '/api/lists', { name: 'X' }],
      ['PUT', '/api/lists/order', [{ id: 'x', sortOrder: 0 }]],
      ['POST', '/api/lists/from-selection', { name: 'X', gearItemIds: ['x'] }],
      ['POST', '/api/lists/some-id/duplicate', undefined],
      ['PATCH', '/api/lists/some-id', { name: 'X' }],
      ['DELETE', '/api/lists/some-id', undefined],
      ['GET', '/api/lists/some-id/items', undefined],
      ['POST', '/api/lists/some-id/items', { gearItemId: 'x' }],
      ['POST', '/api/lists/some-id/items/quick-add', { name: 'X' }],
      ['PUT', '/api/lists/some-id/items/order', [{ id: 'x', sortOrder: 0 }]],
      ['POST', '/api/lists/some-id/items/reset-packed', undefined],
      ['POST', '/api/lists/some-id/items/reset-ready', undefined],
      ['PATCH', '/api/lists/some-id/items/item-id', { quantity: 2 }],
      ['DELETE', '/api/lists/some-id/items/item-id', undefined],
    ] as const) {
      const res = await apiRequest(null, method, path, body)
      expect(res.status, `${method} ${path}`).toBe(401)
    }
  })

  it("cross-user access is indistinguishable from nonexistence", async () => {
    const a = await signUpVerifiedUser('lists-a@example.com', 'A')
    const b = await signUpVerifiedUser('lists-b@example.com', 'B')
    const aList = await createList(a.cookie, 'A list')
    const aGear = await createGear(a.cookie, 'A gear')
    const aItem = await addItem(a.cookie, aList.id, aGear)

    // B cannot see, mutate, or stitch onto A's resources.
    for (const [method, path, body, want] of [
      ['GET', `/api/lists/${aList.id}/items`, undefined, 404],
      ['PATCH', `/api/lists/${aList.id}`, { name: 'stolen' }, 404],
      ['DELETE', `/api/lists/${aList.id}`, undefined, 404],
      ['POST', `/api/lists/${aList.id}/duplicate`, undefined, 404],
      ['POST', `/api/lists/${aList.id}/items`, { gearItemId: aGear }, 404],
      [
        'POST',
        `/api/lists/${aList.id}/items/quick-add`,
        { name: 'X' },
        404,
      ],
      ['POST', `/api/lists/${aList.id}/items/reset-packed`, undefined, 404],
      ['POST', `/api/lists/${aList.id}/items/reset-ready`, undefined, 404],
      [
        'PATCH',
        `/api/lists/${aList.id}/items/${aItem.id}`,
        { quantity: 5 },
        404,
      ],
      [
        'DELETE',
        `/api/lists/${aList.id}/items/${aItem.id}`,
        undefined,
        404,
      ],
    ] as const) {
      const res = await apiRequest(b.cookie, method, path, body)
      expect(res.status, `${method} ${path}`).toBe(want)
    }

    // B's own list cannot embed A's gear.
    const bList = await createList(b.cookie, 'B list')
    const add = await apiRequest(
      b.cookie,
      'POST',
      `/api/lists/${bList.id}/items`,
      { gearItemId: aGear },
    )
    expect(add.status).toBe(400)

    // ...nor quick-add into A's category (own list, foreign category).
    const aCatRes = await apiRequest(a.cookie, 'POST', '/api/categories', {
      name: 'A cat',
    })
    const aCat = (await aCatRes.json()) as { id: string }
    const qa = await apiRequest(
      b.cookie,
      'POST',
      `/api/lists/${bList.id}/items/quick-add`,
      { name: 'Sneaky', categoryId: aCat.id },
    )
    expect(qa.status).toBe(400)

    // from-selection with any foreign id: 400 and ZERO writes.
    const before = (await getLists(b.cookie)).length
    const sel = await apiRequest(b.cookie, 'POST', '/api/lists/from-selection', {
      name: 'Stitched',
      gearItemIds: [aGear],
    })
    expect(sel.status).toBe(400)
    expect((await getLists(b.cookie)).length).toBe(before)

    // Reorder payload naming A's list: 404, and A's order is untouched.
    const reorder = await apiRequest(b.cookie, 'PUT', '/api/lists/order', [
      { id: bList.id, sortOrder: 5 },
      { id: aList.id, sortOrder: 9 },
    ])
    expect(reorder.status).toBe(404)
    expect((await getLists(b.cookie))[0]?.sortOrder).toBe(0)
  })
})

describe('lists CRUD', () => {
  it('create -> list -> patch -> delete round-trip', async () => {
    const { cookie } = await signUpVerifiedUser('lists-crud@example.com', 'C')

    const first = await createList(cookie, 'Overnighter')
    expect(listResponseSchema.parse(first)).toBeTruthy()
    expect(first.slug).toMatch(/^[A-Za-z0-9]{6}$/)
    expect(first.isDraft).toBe(true) // new lists are drafts (old behavior)
    expect(first.isShared).toBe(false)
    expect(first.sortOrder).toBe(0)

    const second = await createList(cookie, 'Thru-hike')
    expect(second.sortOrder).toBe(1) // server-assigned max+1
    expect(second.slug).not.toBe(first.slug)

    await sleep(5)
    const patch = await apiRequest(cookie, 'PATCH', `/api/lists/${first.id}`, {
      name: 'Overnighter v2',
      description: 'Two nights, one bag',
      groupWorn: true,
      readyChecksEnabled: true,
      isDraft: false,
    })
    expect(patch.status).toBe(200)
    const patched = (await patch.json()) as ListBody
    expect(patched.name).toBe('Overnighter v2')
    expect(patched.description).toBe('Two nights, one bag')
    expect(patched.groupWorn).toBe(true)
    expect(patched.readyChecksEnabled).toBe(true)
    expect(patched.isDraft).toBe(false)
    expect(patched.updatedAt > first.updatedAt).toBe(true)
    expect(patched.slug).toBe(first.slug) // patches never touch the slug

    // null clears description
    const clear = await apiRequest(cookie, 'PATCH', `/api/lists/${first.id}`, {
      description: null,
    })
    expect(((await clear.json()) as ListBody).description).toBeNull()

    // Strictness: empty patch and unknown fields are 400s.
    for (const bad of [{}, { isShared: true }, { name: '' }]) {
      const res = await apiRequest(
        cookie,
        'PATCH',
        `/api/lists/${first.id}`,
        bad,
      )
      expect(res.status, JSON.stringify(bad)).toBe(400)
    }

    const del = await apiRequest(cookie, 'DELETE', `/api/lists/${first.id}`)
    expect(del.status).toBe(204)
    expect((await getLists(cookie)).map((l) => l.id)).toEqual([second.id])
  })

  it('deleting a list cascades its membership rows but never the gear', async () => {
    const { cookie } = await signUpVerifiedUser(
      'lists-cascade@example.com',
      'C',
    )
    const list = await createList(cookie, 'Doomed')
    const gearId = await createGear(cookie, 'Survivor')
    await addItem(cookie, list.id, gearId)

    const del = await apiRequest(cookie, 'DELETE', `/api/lists/${list.id}`)
    expect(del.status).toBe(204)

    const orphans = await env.DB.prepare(
      `select count(*) as n from list_items where list_id = ?`,
    )
      .bind(list.id)
      .first<{ n: number }>()
    expect(orphans?.n).toBe(0)

    const gear = await apiRequest(cookie, 'GET', '/api/gear-items')
    expect(((await gear.json()) as { id: string }[]).map((g) => g.id)).toEqual([
      gearId,
    ])
  })

  it('reorder rewrites sortOrder without bumping updatedAt', async () => {
    const { cookie } = await signUpVerifiedUser(
      'lists-reorder@example.com',
      'R',
    )
    const one = await createList(cookie, 'One')
    const two = await createList(cookie, 'Two')

    await sleep(5)
    const res = await apiRequest(cookie, 'PUT', '/api/lists/order', [
      { id: one.id, sortOrder: 1 },
      { id: two.id, sortOrder: 0 },
    ])
    expect(res.status).toBe(204)

    const after = await getLists(cookie)
    expect(after.map((l) => l.name)).toEqual(['Two', 'One'])
    // The product rule ported from the old repo: a reorder is not an edit.
    expect(after.find((l) => l.id === one.id)?.updatedAt).toBe(one.updatedAt)
    expect(after.find((l) => l.id === two.id)?.updatedAt).toBe(two.updatedAt)
  })

  it('duplicate deep-copies items and resets sharing/draft state', async () => {
    const { cookie } = await signUpVerifiedUser('lists-dup@example.com', 'D')
    const source = await createList(cookie, 'Base weight')
    const gearA = await createGear(cookie, 'Tarp')
    const gearB = await createGear(cookie, 'Quilt')
    const itemA = await addItem(cookie, source.id, gearA)
    await addItem(cookie, source.id, gearB)

    // Flag state must survive the copy (packed/ready included).
    await apiRequest(
      cookie,
      'PATCH',
      `/api/lists/${source.id}/items/${itemA.id}`,
      { quantity: 3, isWorn: true, isPacked: true, isReady: true },
    )
    // Mark the source shared + published raw (the API deliberately cannot
    // set isShared yet) to prove duplicate resets both.
    await env.DB.prepare(
      `update lists set is_shared = 1, is_draft = 0 where id = ?`,
    )
      .bind(source.id)
      .run()

    const dup = await apiRequest(
      cookie,
      'POST',
      `/api/lists/${source.id}/duplicate`,
    )
    expect(dup.status).toBe(201)
    const copy = (await dup.json()) as ListBody
    expect(copy.name).toBe('Base weight (copy)')
    expect(copy.slug).not.toBe(source.slug)
    expect(copy.isShared).toBe(false)
    expect(copy.isDraft).toBe(true)

    const copiedItems = await getItems(cookie, copy.id)
    expect(copiedItems).toHaveLength(2)
    const copiedA = copiedItems.find((i) => i.gearItemId === gearA)
    expect(copiedA?.quantity).toBe(3)
    expect(copiedA?.isWorn).toBe(true)
    expect(copiedA?.isPacked).toBe(true)
    expect(copiedA?.isReady).toBe(true)

    // A 256-char name still duplicates: the suffix truncates, not 500s.
    const longName = 'x'.repeat(256)
    const long = await createList(cookie, longName)
    const longDup = await apiRequest(
      cookie,
      'POST',
      `/api/lists/${long.id}/duplicate`,
    )
    expect(longDup.status).toBe(201)
    const longCopy = (await longDup.json()) as ListBody
    expect(longCopy.name.length).toBeLessThanOrEqual(256)
    expect(longCopy.name.endsWith(' (copy)')).toBe(true)
  })

  it('from-selection creates the list and items in payload order', async () => {
    const { cookie } = await signUpVerifiedUser('lists-sel@example.com', 'S')
    const gearA = await createGear(cookie, 'Stove')
    const gearB = await createGear(cookie, 'Pot')

    const res = await apiRequest(cookie, 'POST', '/api/lists/from-selection', {
      name: 'Kitchen',
      gearItemIds: [gearB, gearA], // deliberate non-alphabetical order
    })
    expect(res.status).toBe(201)
    const list = (await res.json()) as ListBody
    // description omitted -> defaults to null, same as plain create.
    expect(list.description).toBeNull()

    const items = await getItems(cookie, list.id)
    expect(items.map((i) => i.gearItemId)).toEqual([gearB, gearA])
    expect(items.map((i) => i.sortOrder)).toEqual([0, 1])
  })

  it('from-selection persists the optional description', async () => {
    const { cookie } = await signUpVerifiedUser('lists-sel-desc@example.com', 'S')
    const gearId = await createGear(cookie, 'Tent')

    const res = await apiRequest(cookie, 'POST', '/api/lists/from-selection', {
      name: 'Overnighter',
      description: 'Two-night shakedown loadout',
      gearItemIds: [gearId],
    })
    expect(res.status).toBe(201)
    const list = (await res.json()) as ListBody
    expect(list.description).toBe('Two-night shakedown loadout')

    // Whitespace-only description is rejected (trim + min(1)) rather than
    // silently stored as an empty string; send null to mean "no notes".
    const blank = await apiRequest(cookie, 'POST', '/api/lists/from-selection', {
      name: 'Blank notes',
      description: '   ',
      gearItemIds: [gearId],
    })
    expect(blank.status).toBe(400)
  })
})

describe('list items', () => {
  it('add existing gear -> embedded gear shape -> patch flags -> remove', async () => {
    const { cookie } = await signUpVerifiedUser('items-crud@example.com', 'I')
    const list = await createList(cookie, 'Pack')
    const gearId = await createGear(cookie, 'Headlamp')

    const item = await addItem(cookie, list.id, gearId)
    expect(listItemResponseSchema.parse(item)).toBeTruthy()
    expect(item.quantity).toBe(1)
    expect(item.gearItem.id).toBe(gearId)
    expect(item.gearItem.name).toBe('Headlamp')

    // The same gear twice is allowed (old-schema parity; quantity is not
    // a substitute in every workflow).
    const again = await apiRequest(cookie, 'POST', `/api/lists/${list.id}/items`, {
      gearItemId: gearId,
    })
    expect(again.status).toBe(201)

    const patch = await apiRequest(
      cookie,
      'PATCH',
      `/api/lists/${list.id}/items/${item.id}`,
      { quantity: 4, isPacked: true },
    )
    expect(patch.status).toBe(200)
    const patched = (await patch.json()) as ItemBody
    expect(patched.quantity).toBe(4)
    expect(patched.isPacked).toBe(true)

    // DTO bounds
    for (const bad of [{ quantity: 0 }, { quantity: 10000 }, {}]) {
      const res = await apiRequest(
        cookie,
        'PATCH',
        `/api/lists/${list.id}/items/${item.id}`,
        bad,
      )
      expect(res.status, JSON.stringify(bad)).toBe(400)
    }

    const del = await apiRequest(
      cookie,
      'DELETE',
      `/api/lists/${list.id}/items/${item.id}`,
    )
    expect(del.status).toBe(204)
    // Removing from the list never deletes the gear.
    const gear = await apiRequest(cookie, 'GET', '/api/gear-items')
    expect(((await gear.json()) as unknown[]).length).toBe(1)

    // Unknown gear is a 400, unknown list a 404.
    const badGear = await apiRequest(
      cookie,
      'POST',
      `/api/lists/${list.id}/items`,
      { gearItemId: 'nope' },
    )
    expect(badGear.status).toBe(400)
    const badList = await apiRequest(cookie, 'POST', '/api/lists/nope/items', {
      gearItemId: gearId,
    })
    expect(badList.status).toBe(404)
  })

  it('worn/consumable exclusivity: merged-state 400, single-patch handoff works', async () => {
    const { cookie } = await signUpVerifiedUser('items-worn@example.com', 'W')
    const list = await createList(cookie, 'Pack')
    const item = await addItem(
      cookie,
      list.id,
      await createGear(cookie, 'Puffy'),
    )
    const path = `/api/lists/${list.id}/items/${item.id}`

    expect(
      (await apiRequest(cookie, 'PATCH', path, { isWorn: true })).status,
    ).toBe(200)

    // Setting consumable while worn is already true: merged-state conflict.
    const conflict = await apiRequest(cookie, 'PATCH', path, {
      isConsumable: true,
    })
    expect(conflict.status).toBe(400)

    // The old UI's toggle handoff sends both flags in one patch - fine.
    const handoff = await apiRequest(cookie, 'PATCH', path, {
      isWorn: false,
      isConsumable: true,
    })
    expect(handoff.status).toBe(200)
    const body = (await handoff.json()) as ItemBody
    expect(body.isWorn).toBe(false)
    expect(body.isConsumable).toBe(true)

    // Statically-impossible both-true patch dies in the DTO.
    const both = await apiRequest(cookie, 'PATCH', path, {
      isWorn: true,
      isConsumable: true,
    })
    expect(both.status).toBe(400)

    // The DB CHECK backstops writes that bypass the repo.
    await expect(
      env.DB.prepare(
        `update list_items set is_worn = 1, is_consumable = 1 where id = ?`,
      )
        .bind(item.id)
        .run(),
    ).rejects.toThrow()
  })

  it('parent-path consistency: the right item under the wrong list 404s', async () => {
    const { cookie } = await signUpVerifiedUser('items-path@example.com', 'P')
    const list1 = await createList(cookie, 'One')
    const list2 = await createList(cookie, 'Two')
    const item = await addItem(
      cookie,
      list1.id,
      await createGear(cookie, 'Spork'),
    )

    const patch = await apiRequest(
      cookie,
      'PATCH',
      `/api/lists/${list2.id}/items/${item.id}`,
      { quantity: 2 },
    )
    expect(patch.status).toBe(404)
    const del = await apiRequest(
      cookie,
      'DELETE',
      `/api/lists/${list2.id}/items/${item.id}`,
    )
    expect(del.status).toBe(404)

    // Reorder naming another list's item: 404, zero writes.
    const foreign = await apiRequest(
      cookie,
      'PUT',
      `/api/lists/${list2.id}/items/order`,
      [{ id: item.id, sortOrder: 3 }],
    )
    expect(foreign.status).toBe(404)
    expect((await getItems(cookie, list1.id))[0]?.sortOrder).toBe(0)
  })

  it('quick-add creates gear + membership atomically', async () => {
    const { cookie } = await signUpVerifiedUser('items-qa@example.com', 'Q')
    const list = await createList(cookie, 'Pack')
    const catRes = await apiRequest(cookie, 'POST', '/api/categories', {
      name: 'Cook',
    })
    const category = (await catRes.json()) as { id: string }

    const res = await apiRequest(
      cookie,
      'POST',
      `/api/lists/${list.id}/items/quick-add`,
      { name: 'Windscreen', weightGrams: 30, categoryId: category.id },
    )
    expect(res.status).toBe(201)
    const item = (await res.json()) as ItemBody
    expect(item.gearItem.name).toBe('Windscreen')

    // The gear row is real library gear.
    const gear = await apiRequest(cookie, 'GET', '/api/gear-items')
    const gearBody = (await gear.json()) as {
      id: string
      categoryId: string | null
    }[]
    expect(gearBody.map((g) => g.id)).toContain(item.gearItemId)
    expect(gearBody.find((g) => g.id === item.gearItemId)?.categoryId).toBe(
      category.id,
    )

    // Foreign/unknown category: 400, and no gear row leaks out of the
    // refused call.
    const before = gearBody.length
    const bad = await apiRequest(
      cookie,
      'POST',
      `/api/lists/${list.id}/items/quick-add`,
      { name: 'Ghost', categoryId: 'nope' },
    )
    expect(bad.status).toBe(400)
    const after = (await (
      await apiRequest(cookie, 'GET', '/api/gear-items')
    ).json()) as unknown[]
    expect(after.length).toBe(before)
  })

  it('quick-add accepts membership fields and rejects worn+consumable', async () => {
    const { cookie } = await signUpVerifiedUser('items-qa2@example.com', 'Q')
    const list = await createList(cookie, 'Pack')

    // The Quick-Add form's per-list fields persist onto the membership row.
    const res = await apiRequest(
      cookie,
      'POST',
      `/api/lists/${list.id}/items/quick-add`,
      { name: 'Trail bars', weightGrams: 250, quantity: 4, isConsumable: true },
    )
    expect(res.status).toBe(201)
    const item = (await res.json()) as ItemBody
    expect(item.quantity).toBe(4)
    expect(item.isConsumable).toBe(true)
    expect(item.isWorn).toBe(false)

    // Omitted fields keep their defaults.
    const plain = await apiRequest(
      cookie,
      'POST',
      `/api/lists/${list.id}/items/quick-add`,
      { name: 'Spork' },
    )
    expect(plain.status).toBe(201)
    const plainItem = (await plain.json()) as ItemBody
    expect(plainItem.quantity).toBe(1)
    expect(plainItem.isWorn).toBe(false)
    expect(plainItem.isConsumable).toBe(false)

    // Statically-impossible both-true is rejected at the schema, and the
    // refused call creates no gear row (nothing reached the batch).
    const gearBefore = (await (
      await apiRequest(cookie, 'GET', '/api/gear-items')
    ).json()) as unknown[]
    const both = await apiRequest(
      cookie,
      'POST',
      `/api/lists/${list.id}/items/quick-add`,
      { name: 'Impossible', isWorn: true, isConsumable: true },
    )
    expect(both.status).toBe(400)
    const gearAfter = (await (
      await apiRequest(cookie, 'GET', '/api/gear-items')
    ).json()) as unknown[]
    expect(gearAfter.length).toBe(gearBefore.length)

    // Out-of-range quantity is rejected too.
    const qty = await apiRequest(
      cookie,
      'POST',
      `/api/lists/${list.id}/items/quick-add`,
      { name: 'Too many', quantity: 10000 },
    )
    expect(qty.status).toBe(400)
  })

  it('item reorder respects sortOrder without bumping updatedAt', async () => {
    const { cookie } = await signUpVerifiedUser('items-order@example.com', 'O')
    const list = await createList(cookie, 'Pack')
    const a = await addItem(cookie, list.id, await createGear(cookie, 'A'))
    const b = await addItem(cookie, list.id, await createGear(cookie, 'B'))
    expect([a.sortOrder, b.sortOrder]).toEqual([0, 1])

    await sleep(5)
    const res = await apiRequest(
      cookie,
      'PUT',
      `/api/lists/${list.id}/items/order`,
      [
        { id: a.id, sortOrder: 1 },
        { id: b.id, sortOrder: 0 },
      ],
    )
    expect(res.status).toBe(204)
    const items = await getItems(cookie, list.id)
    expect(items.map((i) => i.id)).toEqual([b.id, a.id])
    // EVERY reordered row keeps its updatedAt, not just the first.
    expect(items.find((i) => i.id === a.id)?.updatedAt).toBe(a.updatedAt)
    expect(items.find((i) => i.id === b.id)?.updatedAt).toBe(b.updatedAt)
  })

  it('reset-packed and reset-ready clear only their own flag', async () => {
    const { cookie } = await signUpVerifiedUser('items-reset@example.com', 'R')
    const list = await createList(cookie, 'Pack')
    const a = await addItem(cookie, list.id, await createGear(cookie, 'A'))
    const b = await addItem(cookie, list.id, await createGear(cookie, 'B'))
    for (const id of [a.id, b.id]) {
      await apiRequest(cookie, 'PATCH', `/api/lists/${list.id}/items/${id}`, {
        isPacked: true,
        isReady: true,
      })
    }

    const reset = await apiRequest(
      cookie,
      'POST',
      `/api/lists/${list.id}/items/reset-packed`,
    )
    expect(reset.status).toBe(204)
    const items = await getItems(cookie, list.id)
    expect(items.every((i) => !i.isPacked)).toBe(true)
    expect(items.every((i) => i.isReady)).toBe(true)

    const resetReady = await apiRequest(
      cookie,
      'POST',
      `/api/lists/${list.id}/items/reset-ready`,
    )
    expect(resetReady.status).toBe(204)
    expect((await getItems(cookie, list.id)).every((i) => !i.isReady)).toBe(
      true,
    )
  })
})

describe('caps and slug integrity', () => {
  it('the 100-list cap: friendly 422 from the API, trigger backstop raw', async () => {
    const { cookie } = await signUpVerifiedUser('lists-cap@example.com', 'C')
    const userId = await userIdFor(cookie)

    const values = Array.from({ length: 99 }, (_, i) => {
      const slug = `s${String(i).padStart(5, '0')}`
      return `('seed-${i}', '${userId}', 'Seed list ${i}', '${slug}', 0, 0, 0, 1, ${i}, 0, 0)`
    }).join(',')
    await env.DB.prepare(
      `insert into lists (id, user_id, name, slug, is_shared, group_worn, ready_checks_enabled, is_draft, sort_order, created_at, updated_at) values ${values}`,
    ).run()

    const at100 = await apiRequest(cookie, 'POST', '/api/lists', {
      name: 'The 100th',
    })
    expect(at100.status).toBe(201)

    const over = await apiRequest(cookie, 'POST', '/api/lists', {
      name: 'One too many',
    })
    expect(over.status).toBe(422)

    await expect(
      env.DB.prepare(
        `insert into lists (id, user_id, name, slug, is_shared, group_worn, ready_checks_enabled, is_draft, sort_order, created_at, updated_at) values ('bypass', '${userId}', 'Bypass', 'bypass', 0, 0, 0, 1, 0, 0, 0)`,
      ).run(),
    ).rejects.toThrow(/cap/)
  })

  it('the 300-item cap: friendly 422, and a refused quick-add creates no gear', async () => {
    const { cookie } = await signUpVerifiedUser('items-cap@example.com', 'C')
    const userId = await userIdFor(cookie)
    const list = await createList(cookie, 'Big')
    const gearId = await createGear(cookie, 'Filler')

    // No UNIQUE(list_id, gear_item_id), so one gear row can seed all 299.
    const values = Array.from({ length: 299 }, (_, i) => {
      return `('seed-${i}', '${userId}', '${list.id}', '${gearId}', 1, 0, 0, 0, 0, ${i}, 0, 0)`
    }).join(',')
    await env.DB.prepare(
      `insert into list_items (id, user_id, list_id, gear_item_id, quantity, is_worn, is_consumable, is_packed, is_ready, sort_order, created_at, updated_at) values ${values}`,
    ).run()

    const at300 = await apiRequest(cookie, 'POST', `/api/lists/${list.id}/items`, {
      gearItemId: gearId,
    })
    expect(at300.status).toBe(201)

    const over = await apiRequest(cookie, 'POST', `/api/lists/${list.id}/items`, {
      gearItemId: gearId,
    })
    expect(over.status).toBe(422)
    expect(((await over.json()) as { error: string }).error).toContain(
      '300 per list',
    )

    // Quick-add at the cap: the batch aborts as a unit - the 422 must not
    // leave a stray gear row behind (this pins the transaction boundary).
    const gearBefore = (
      (await (await apiRequest(cookie, 'GET', '/api/gear-items')).json()) as unknown[]
    ).length
    const qa = await apiRequest(
      cookie,
      'POST',
      `/api/lists/${list.id}/items/quick-add`,
      { name: 'Straw' },
    )
    expect(qa.status).toBe(422)
    const gearAfter = (
      (await (await apiRequest(cookie, 'GET', '/api/gear-items')).json()) as unknown[]
    ).length
    expect(gearAfter).toBe(gearBefore)
  })

  it('bulk surfaces above 100 ids work (D1 binds max 100 params/query)', async () => {
    // Regression for the inArray param fan-out (see chunk-ids.ts): lists
    // reorder at the full LIST_CAP (100 ids + userId = 101 params),
    // from-selection with 150 gear ids, and list-items reorder at 150.
    const { cookie } = await signUpVerifiedUser('lists-many@example.com', 'M')
    const userId = await userIdFor(cookie)

    // from-selection with 150 gear ids (list #1 of the eventual 100).
    const gearValues = Array.from({ length: 150 }, (_, i) => {
      return `('selmany-${i}', '${userId}', 'Sel gear ${i}', 0, 'active', ${i}, 0, 0)`
    }).join(',')
    await env.DB.prepare(
      `insert into gear_items (id, user_id, name, weight_grams, status, sort_order, created_at, updated_at) values ${gearValues}`,
    ).run()
    const gearIds = Array.from({ length: 150 }, (_, i) => `selmany-${i}`)
    const sel = await apiRequest(cookie, 'POST', '/api/lists/from-selection', {
      name: 'Big selection',
      gearItemIds: gearIds,
    })
    expect(sel.status).toBe(201)
    const bigList = (await sel.json()) as { id: string }
    const items = await getItems(cookie, bigList.id)
    expect(items).toHaveLength(150)

    // List-items reorder at 150.
    const reorderItems = await apiRequest(
      cookie,
      'PUT',
      `/api/lists/${bigList.id}/items/order`,
      items.map((it, i) => ({ id: it.id, sortOrder: 149 - i })),
    )
    expect(reorderItems.status).toBe(204)

    // Lists reorder at exactly LIST_CAP: 99 seeded + the selection list
    // (seeding 100 first would make from-selection the 101st and 422).
    const listValues = Array.from({ length: 99 }, (_, i) => {
      return `('listmany-${i}', '${userId}', 'List ${i}', 'LM${String(i).padStart(4, '0')}', 0, 0, 0, 1, ${i + 10}, 0, 0)`
    }).join(',')
    await env.DB.prepare(
      `insert into lists (id, user_id, name, slug, is_shared, group_worn, ready_checks_enabled, is_draft, sort_order, created_at, updated_at) values ${listValues}`,
    ).run()
    const reorderIds = [
      bigList.id,
      ...Array.from({ length: 99 }, (_, i) => `listmany-${i}`),
    ]
    const reorderLists = await apiRequest(cookie, 'PUT', '/api/lists/order',
      reorderIds.map((id, i) => ({ id, sortOrder: 99 - i })),
    )
    expect(reorderLists.status).toBe(204)
    // bigList got the highest slot, so it sorts last now.
    const after = await getLists(cookie)
    expect(after).toHaveLength(100)
    expect(after[99]?.name).toBe('Big selection')
  })

  it('slugs are unique at the DB level with the matcher-visible error shape', async () => {
    const { cookie } = await signUpVerifiedUser('lists-slug@example.com', 'S')
    const userId = await userIdFor(cookie)
    await env.DB.prepare(
      `insert into lists (id, user_id, name, slug, is_shared, group_worn, ready_checks_enabled, is_draft, sort_order, created_at, updated_at) values ('slug-1', '${userId}', 'One', 'AAAAAA', 0, 0, 0, 1, 0, 0, 0)`,
    ).run()
    // Pins the real error text isUniqueViolation matches on.
    await expect(
      env.DB.prepare(
        `insert into lists (id, user_id, name, slug, is_shared, group_worn, ready_checks_enabled, is_draft, sort_order, created_at, updated_at) values ('slug-2', '${userId}', 'Two', 'AAAAAA', 0, 0, 0, 1, 1, 0, 0)`,
      ).run(),
    ).rejects.toThrow(/UNIQUE constraint failed: lists.slug/)
  })
})
