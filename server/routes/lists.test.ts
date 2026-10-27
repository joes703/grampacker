import { testDb } from '../test/node-env'
import { describe, expect, it } from 'vitest'
import {
  listItemResponseSchema,
  listResponseSchema,
} from '../../shared/lists'
import { apiRequest, addListItem, createGearItemId, createList, getListItems, getLists, userIdFor } from '../test/api-helpers'
import { signUpVerifiedUser } from '../test/auth-helpers'

type ListBody = {
  id: string
  name: string
  description: string | null
  slug: string
  isShared: boolean
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
  gearItem: { id: string; name: string; weightGrams: number }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('/api/lists authorization matrix', () => {
  it('anon requests are 401 on every route', async () => {
    for (const [method, path, body] of [
      ['GET', '/api/lists', undefined],
      ['POST', '/api/lists', { name: 'X' }],
      ['PUT', '/api/lists/order', [{ id: 'x', sortOrder: 0 }]],
      ['POST', '/api/lists/from-selection', { name: 'X', gearItemIds: ['x'] }],
      ['POST', '/api/lists/import', { name: 'X', categories: [], gear: [], items: [{ gear: { kind: 'existing', id: 'x' }, sortOrder: 0 }] }],
      ['POST', '/api/lists/some-id/duplicate', undefined],
      ['POST', '/api/lists/some-id/share-link', undefined],
      ['PATCH', '/api/lists/some-id', { name: 'X' }],
      ['DELETE', '/api/lists/some-id', undefined],
      ['GET', '/api/lists/some-id/items', undefined],
      ['POST', '/api/lists/some-id/items', { gearItemId: 'x' }],
      ['POST', '/api/lists/some-id/items/quick-add', { name: 'X' }],
      ['PUT', '/api/lists/some-id/items/order', [{ id: 'x', sortOrder: 0 }]],
      [
        'PUT',
        '/api/lists/some-id/items/pack-order',
        [{ id: 'x', packSortOrder: 0 }],
      ],
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
    const aGear = await createGearItemId(a.cookie, 'A gear')
    const aItem = await addListItem(a.cookie, aList.id, aGear)

    // B cannot see, mutate, or stitch onto A's resources.
    for (const [method, path, body, want] of [
      ['GET', `/api/lists/${aList.id}/items`, undefined, 404],
      ['PATCH', `/api/lists/${aList.id}`, { name: 'stolen', isShared: true }, 404],
      ['DELETE', `/api/lists/${aList.id}`, undefined, 404],
      ['POST', `/api/lists/${aList.id}/duplicate`, undefined, 404],
      ['POST', `/api/lists/${aList.id}/share-link`, undefined, 404],
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
    // A 404 with zero effect: an update-then-check bug would answer 404 too,
    // after renaming A's list and publishing it.
    expect((await getLists(a.cookie)).find((l) => l.id === aList.id)?.name).toBe('A list')
    expect((await apiRequest(null, 'GET', `/api/shares/v2/${aList.slug}`)).status).toBe(404)

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
      isDraft: false,
    })
    expect(patch.status).toBe(200)
    const patched = (await patch.json()) as ListBody
    expect(patched.name).toBe('Overnighter v2')
    expect(patched.description).toBe('Two nights, one bag')
    expect(patched.isDraft).toBe(false)
    expect(patched.updatedAt > first.updatedAt).toBe(true)
    expect(patched.slug).toBe(first.slug) // patches never touch the slug

    // A retired key on a PATCH is refused outright. The request schema is
    // strict, so the whole patch 400s rather than applying the rest and
    // dropping the unknown field - no silent half-write.
    //
    // Narrow on purpose. These two keys only ever went out from the
    // ready-checks and worn-grouping toggles, and both were gone from the
    // client well before this change - so no shipped bundle sends either. A
    // stale tab's rename, notes, draft and share calls each send one field
    // and are accepted here.
    //
    // Which means the request side was never the risk here. The RESPONSE
    // losing a field an old bundle's schema still requires is - that tab sees
    // its own committed writes fail until it is reloaded. Accepted
    // deliberately rather than staged across two releases; see the contract
    // note in src/lib/api.ts.
    const retired = await apiRequest(cookie, 'PATCH', `/api/lists/${first.id}`, {
      name: 'Should not land',
      groupWorn: true,
    })
    expect(retired.status).toBe(400)
    const unchanged = (await (
      await apiRequest(cookie, 'GET', `/api/lists`)
    ).json()) as ListBody[]
    expect(unchanged.find((l) => l.id === first.id)?.name).toBe('Overnighter v2')

    // null clears description
    const clear = await apiRequest(cookie, 'PATCH', `/api/lists/${first.id}`, {
      description: null,
    })
    expect(((await clear.json()) as ListBody).description).toBeNull()

    // Strictness: empty patch and unknown fields are 400s. (isShared used
    // to be in this list; the share slice made it patchable - positive
    // coverage lives in shares.test.ts.)
    for (const bad of [{}, { slug: 'newslug' }, { name: '' }]) {
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
    const gearId = await createGearItemId(cookie, 'Survivor')
    await addListItem(cookie, list.id, gearId)

    const del = await apiRequest(cookie, 'DELETE', `/api/lists/${list.id}`)
    expect(del.status).toBe(204)

    const orphans = await testDb.prepare(
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
    const gearA = await createGearItemId(cookie, 'Tarp')
    const gearB = await createGearItemId(cookie, 'Quilt')
    const itemA = await addListItem(cookie, source.id, gearA)
    await addListItem(cookie, source.id, gearB)

    // Flag state must survive the copy (packed/ready included).
    await apiRequest(
      cookie,
      'PATCH',
      `/api/lists/${source.id}/items/${itemA.id}`,
      { quantity: 3, isWorn: true, isPacked: true, isReady: true },
    )
    // Mark the source shared + published raw (the API deliberately cannot
    // set isShared yet) to prove duplicate resets both.
    await testDb.prepare(
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

    const copiedItems = await getListItems(cookie, copy.id)
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
    const gearA = await createGearItemId(cookie, 'Stove')
    const gearB = await createGearItemId(cookie, 'Pot')

    const res = await apiRequest(cookie, 'POST', '/api/lists/from-selection', {
      name: 'Kitchen',
      gearItemIds: [gearB, gearA], // deliberate non-alphabetical order
    })
    expect(res.status).toBe(201)
    const list = (await res.json()) as ListBody
    // description omitted -> defaults to null, same as plain create.
    expect(list.description).toBeNull()

    const items = await getListItems(cookie, list.id)
    expect(items.map((i) => i.gearItemId)).toEqual([gearB, gearA])
    expect(items.map((i) => i.sortOrder)).toEqual([0, 1])
  })

  it('from-selection persists the optional description', async () => {
    const { cookie } = await signUpVerifiedUser('lists-sel-desc@example.com', 'S')
    const gearId = await createGearItemId(cookie, 'Tent')

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
    const gearId = await createGearItemId(cookie, 'Headlamp')

    const item = await addListItem(cookie, list.id, gearId)
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
    const item = await addListItem(
      cookie,
      list.id,
      await createGearItemId(cookie, 'Puffy'),
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
      testDb.prepare(
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
    const item = await addListItem(
      cookie,
      list1.id,
      await createGearItemId(cookie, 'Spork'),
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
    expect((await getListItems(cookie, list1.id))[0]?.sortOrder).toBe(0)
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
      // Fractional: quick-add has its own DTO
      // (quickAddListItemRequestSchema), so the gear-route round trip does
      // not cover it.
      { name: 'Windscreen', weightGrams: 30.4, categoryId: category.id },
    )
    expect(res.status).toBe(201)
    const item = (await res.json()) as ItemBody
    expect(item.gearItem.name).toBe('Windscreen')
    expect(item.gearItem.weightGrams).toBe(30.4)

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
    const a = await addListItem(cookie, list.id, await createGearItemId(cookie, 'A'))
    const b = await addListItem(cookie, list.id, await createGearItemId(cookie, 'B'))
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
    const items = await getListItems(cookie, list.id)
    expect(items.map((i) => i.id)).toEqual([b.id, a.id])
    // EVERY reordered row keeps its updatedAt, not just the first.
    expect(items.find((i) => i.id === a.id)?.updatedAt).toBe(a.updatedAt)
    expect(items.find((i) => i.id === b.id)?.updatedAt).toBe(b.updatedAt)
  })

  it("item reorder naming ANOTHER USER's item under the caller's own list: 404, zero writes", async () => {
    // The wrong-parent test above uses another of the caller's OWN lists, so
    // it can pass on the list predicate alone. This one holds the parent
    // constant and varies the owner: the caller's list, a foreign item, and a
    // valid local rank change riding along so a partial application shows.
    const a = await signUpVerifiedUser('items-order-foreign-a@example.com', 'A')
    const b = await signUpVerifiedUser('items-order-foreign-b@example.com', 'B')
    const mine = await createList(a.cookie, 'Mine')
    const m1 = await addListItem(a.cookie, mine.id, await createGearItemId(a.cookie, 'M1'))
    const m2 = await addListItem(a.cookie, mine.id, await createGearItemId(a.cookie, 'M2'))
    const theirs = await createList(b.cookie, 'Theirs')
    const t1 = await addListItem(b.cookie, theirs.id, await createGearItemId(b.cookie, 'T1'))
    const before = {
      mine: await getListItems(a.cookie, mine.id),
      theirs: await getListItems(b.cookie, theirs.id),
    }

    const res = await apiRequest(a.cookie, 'PUT', `/api/lists/${mine.id}/items/order`, [
      { id: m1.id, sortOrder: m2.sortOrder },
      { id: m2.id, sortOrder: m1.sortOrder },
      { id: t1.id, sortOrder: 7 },
    ])
    expect(res.status).toBe(404)
    expect({
      mine: await getListItems(a.cookie, mine.id),
      theirs: await getListItems(b.cookie, theirs.id),
    }).toEqual(before)
  })

  it("item reorder by a NON-OWNER through the item's real parent: 404, zero writes", async () => {
    const a = await signUpVerifiedUser('items-order-victim@example.com', 'A')
    const b = await signUpVerifiedUser('items-order-intruder@example.com', 'B')
    const list = await createList(a.cookie, 'Victim')
    const i1 = await addListItem(a.cookie, list.id, await createGearItemId(a.cookie, 'I1'))
    const i2 = await addListItem(a.cookie, list.id, await createGearItemId(a.cookie, 'I2'))
    const before = await getListItems(a.cookie, list.id)

    const res = await apiRequest(b.cookie, 'PUT', `/api/lists/${list.id}/items/order`, [
      { id: i1.id, sortOrder: i2.sortOrder },
      { id: i2.id, sortOrder: i1.sortOrder },
    ])
    expect(res.status).toBe(404)
    expect(await getListItems(a.cookie, list.id)).toEqual(before)
  })

  it('reset-packed and reset-ready clear only their own flag', async () => {
    const { cookie } = await signUpVerifiedUser('items-reset@example.com', 'R')
    const list = await createList(cookie, 'Pack')
    const a = await addListItem(cookie, list.id, await createGearItemId(cookie, 'A'))
    const b = await addListItem(cookie, list.id, await createGearItemId(cookie, 'B'))
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
    const items = await getListItems(cookie, list.id)
    expect(items.every((i) => !i.isPacked)).toBe(true)
    expect(items.every((i) => i.isReady)).toBe(true)

    const resetReady = await apiRequest(
      cookie,
      'POST',
      `/api/lists/${list.id}/items/reset-ready`,
    )
    expect(resetReady.status).toBe(204)
    expect((await getListItems(cookie, list.id)).every((i) => !i.isReady)).toBe(
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
      return `('seed-${i}', '${userId}', 'Seed list ${i}', '${slug}', 0, 1, ${i}, 0, 0)`
    }).join(',')
    await testDb.prepare(
      `insert into lists (id, user_id, name, slug, is_shared, is_draft, sort_order, created_at, updated_at) values ${values}`,
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
      testDb.prepare(
        `insert into lists (id, user_id, name, slug, is_shared, is_draft, sort_order, created_at, updated_at) values ('bypass', '${userId}', 'Bypass', 'bypass', 0, 1, 0, 0, 0)`,
      ).run(),
    ).rejects.toThrow(/cap/)
  })

  it('the 300-item cap: friendly 422, and a refused quick-add creates no gear', async () => {
    const { cookie } = await signUpVerifiedUser('items-cap@example.com', 'C')
    const userId = await userIdFor(cookie)
    const list = await createList(cookie, 'Big')
    const gearId = await createGearItemId(cookie, 'Filler')

    // No UNIQUE(list_id, gear_item_id), so one gear row can seed all 299.
    //
    // pack_sort_order is supplied explicitly, and must be: it is UNIQUE per
    // cohort, these rows are all Unassigned (one cohort), and the column
    // DEFAULTs to 0 - so leaving it out makes 299 rows collide on rank 0 and
    // the seed fails before the cap is ever reached.
    const values = Array.from({ length: 299 }, (_, i) => {
      return `('seed-${i}', '${userId}', '${list.id}', '${gearId}', 1, 0, 0, 0, 0, ${i}, ${i}, 0, 0)`
    }).join(',')
    await testDb.prepare(
      `insert into list_items (id, user_id, list_id, gear_item_id, quantity, is_worn, is_consumable, is_packed, is_ready, sort_order, pack_sort_order, created_at, updated_at) values ${values}`,
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

  it('import: list + categories + gear + items land atomically with CSV row-index sort orders', async () => {
    const { cookie } = await signUpVerifiedUser('lists-import@example.com', 'I')
    const catRes = await apiRequest(cookie, 'POST', '/api/categories', { name: 'Shelter' })
    const shelter = (await catRes.json()) as { id: string }
    const tentId = await createGearItemId(cookie, 'Tent')

    const res = await apiRequest(cookie, 'POST', '/api/lists/import', {
      name: 'PCT section',
      categories: [{ tempId: 'cat-0', name: 'Cooking' }],
      gear: [
        {
          tempId: 'gear-0',
          name: 'Stove',
          description: 'Canister top',
          weightGrams: 85,
          category: { kind: 'new', tempId: 'cat-0' },
        },
        { tempId: 'gear-1', name: 'Headlamp', category: null },
        {
          tempId: 'gear-2',
          name: 'Stakes',
          // Fractional: the list-import DTO shares weightGramsSchema with the
          // gear routes, and this is the only place that path is exercised.
          weightGrams: 60.4,
          category: { kind: 'existing', id: shelter.id },
        },
      ],
      items: [
        // sortOrders 0,2,3,4: the gap at 1 is a dropped empty-name CSV
        // row and must survive the round trip (old-repo parity).
        { gear: { kind: 'existing', id: tentId }, quantity: 2, isWorn: true, sortOrder: 0 },
        { gear: { kind: 'new', tempId: 'gear-0' }, isConsumable: true, sortOrder: 2 },
        { gear: { kind: 'new', tempId: 'gear-1' }, sortOrder: 3 },
        { gear: { kind: 'new', tempId: 'gear-2' }, quantity: 6, sortOrder: 4 },
      ],
    })
    expect(res.status).toBe(201)
    const list = listResponseSchema.parse(await res.json())
    expect(list.name).toBe('PCT section')

    const items = await getListItems(cookie, list.id)
    expect(items.map((i) => i.sortOrder)).toEqual([0, 2, 3, 4])
    expect(items[0]).toMatchObject({ gearItemId: tentId, quantity: 2, isWorn: true, isConsumable: false })
    expect(items[1]).toMatchObject({ quantity: 1, isWorn: false, isConsumable: true })
    expect(items[3]).toMatchObject({ quantity: 6 })

    // The new gear landed in the library with resolved category ids.
    const gear = (await (await apiRequest(cookie, 'GET', '/api/gear-items')).json()) as {
      name: string
      categoryId: string | null
      weightGrams: number
    }[]
    expect(gear).toHaveLength(4) // Tent + 3 imported
    const cats = (await (await apiRequest(cookie, 'GET', '/api/categories')).json()) as {
      id: string
      name: string
    }[]
    expect(cats.map((c) => c.name)).toEqual(['Shelter', 'Cooking'])
    const cooking = cats.find((c) => c.name === 'Cooking')
    expect(gear.find((g) => g.name === 'Stove')?.categoryId).toBe(cooking?.id)
    expect(gear.find((g) => g.name === 'Headlamp')?.categoryId).toBeNull()
    expect(gear.find((g) => g.name === 'Stakes')?.categoryId).toBe(shelter.id)
    expect(gear.find((g) => g.name === 'Stakes')?.weightGrams).toBe(60.4)
  })

  it('import: gear cost lands as cents, keeping zero distinct from unknown', async () => {
    // The zero/null distinction has to survive the whole DTO -> route ->
    // SQLite path, not just the parser. A free item is 0 cents; an unpriced one
    // is NULL. Collapsing either direction is invisible in the UI.
    const { cookie } = await signUpVerifiedUser('lists-import-cost@example.com', 'C')
    const res = await apiRequest(cookie, 'POST', '/api/lists/import', {
      name: 'Priced',
      categories: [],
      gear: [
        { tempId: 'g-priced', name: 'Tent', cost: 27.29 },
        { tempId: 'g-free', name: 'Gifted mug', cost: 0 },
        { tempId: 'g-null', name: 'Explicit null', cost: null },
        { tempId: 'g-omitted', name: 'Omitted entirely' },
      ],
      items: [
        { gear: { kind: 'new', tempId: 'g-priced' }, sortOrder: 0 },
        { gear: { kind: 'new', tempId: 'g-free' }, sortOrder: 1 },
        { gear: { kind: 'new', tempId: 'g-null' }, sortOrder: 2 },
        { gear: { kind: 'new', tempId: 'g-omitted' }, sortOrder: 3 },
      ],
    })
    expect(res.status).toBe(201)

    const gear = (await (await apiRequest(cookie, 'GET', '/api/gear-items')).json()) as {
      name: string
      cost: number | null
    }[]
    const costOf = (name: string) => gear.find((g) => g.name === name)?.cost
    expect(costOf('Tent')).toBe(27.29)
    // Free, NOT unknown.
    expect(costOf('Gifted mug')).toBe(0)
    // Unknown, NOT free - both the explicit null and the omitted field.
    expect(costOf('Explicit null')).toBeNull()
    expect(costOf('Omitted entirely')).toBeNull()
  })

  it('import: invalid gear costs are rejected 400 rather than coerced', async () => {
    // costSchema is shared with the gear import; a list import must not be
    // a side door around it.
    const { cookie } = await signUpVerifiedUser('lists-import-badcost@example.com', 'B')
    const bad = [-1, 100_000_000, 12.345]
    for (const cost of bad) {
      const res = await apiRequest(cookie, 'POST', '/api/lists/import', {
        name: 'Bad',
        categories: [],
        gear: [{ tempId: 'g0', name: 'X', cost }],
        items: [{ gear: { kind: 'new', tempId: 'g0' }, sortOrder: 0 }],
      })
      expect(res.status, `cost=${cost}`).toBe(400)
    }
    // ...and nothing was written by any of them.
    const lists = (await (await apiRequest(cookie, 'GET', '/api/lists')).json()) as unknown[]
    expect(lists).toHaveLength(0)
  })

  it('import: foreign category or gear refs are 400 with zero writes', async () => {
    const a = await signUpVerifiedUser('lists-import-a@example.com', 'A')
    const b = await signUpVerifiedUser('lists-import-b@example.com', 'B')
    const bCatRes = await apiRequest(b.cookie, 'POST', '/api/categories', { name: 'Bs' })
    const bCat = (await bCatRes.json()) as { id: string }
    const bGear = await createGearItemId(b.cookie, 'Foreign tent')

    const viaCategory = await apiRequest(a.cookie, 'POST', '/api/lists/import', {
      name: 'Sneaky',
      categories: [],
      gear: [{ tempId: 'g0', name: 'X', category: { kind: 'existing', id: bCat.id } }],
      items: [{ gear: { kind: 'new', tempId: 'g0' }, sortOrder: 0 }],
    })
    expect(viaCategory.status).toBe(400)

    const viaGear = await apiRequest(a.cookie, 'POST', '/api/lists/import', {
      name: 'Sneaky 2',
      categories: [],
      gear: [],
      items: [{ gear: { kind: 'existing', id: bGear }, sortOrder: 0 }],
    })
    expect(viaGear.status).toBe(400)

    expect(await getLists(a.cookie)).toHaveLength(0)
    expect(
      (await (await apiRequest(a.cookie, 'GET', '/api/gear-items')).json()) as unknown[],
    ).toHaveLength(0)
  })

  it('import over the gear cap rolls back the WHOLE batch: no list, categories, or gear orphans', async () => {
    const { cookie } = await signUpVerifiedUser('lists-import-cap@example.com', 'C')
    const userId = await userIdFor(cookie)

    const values = Array.from({ length: 499 }, (_, i) => {
      return `('importcap-${i}', '${userId}', 'Seed ${i}', 0, 'active', ${i}, 0, 0)`
    }).join(',')
    await testDb.prepare(
      `insert into gear_items (id, user_id, name, weight_grams, status, sort_order, created_at, updated_at) values ${values}`,
    ).run()

    // 499 existing + 2 new = 501: the gear cap trigger aborts mid-batch.
    // The old app's RPC was atomic and this must stay atomic: the list
    // row, the new category, AND the first gear row all roll back.
    const res = await apiRequest(cookie, 'POST', '/api/lists/import', {
      name: 'Doomed',
      categories: [{ tempId: 'c0', name: 'Orphan-to-be' }],
      gear: [
        { tempId: 'g0', name: 'Fits', category: { kind: 'new', tempId: 'c0' } },
        { tempId: 'g1', name: 'One too many', category: null },
      ],
      items: [
        { gear: { kind: 'new', tempId: 'g0' }, sortOrder: 0 },
        { gear: { kind: 'new', tempId: 'g1' }, sortOrder: 1 },
      ],
    })
    expect(res.status).toBe(422)
    expect(await getLists(cookie)).toHaveLength(0)
    expect(
      (await (await apiRequest(cookie, 'GET', '/api/categories')).json()) as unknown[],
    ).toHaveLength(0)
    expect(
      (await (await apiRequest(cookie, 'GET', '/api/gear-items')).json()) as unknown[],
    ).toHaveLength(499)
  })

  it('import validation: tempId wiring, flags, quantity, sortOrders', async () => {
    const { cookie } = await signUpVerifiedUser('lists-import-v@example.com', 'V')
    const gearId = await createGearItemId(cookie, 'Real')
    const existingItem = { gear: { kind: 'existing', id: gearId }, sortOrder: 0 }
    for (const body of [
      // unknown gear tempId
      { name: 'L', categories: [], gear: [], items: [{ gear: { kind: 'new', tempId: 'ghost' }, sortOrder: 0 }] },
      // declared gear nothing references
      { name: 'L', categories: [], gear: [{ tempId: 'orphan', name: 'X' }], items: [existingItem] },
      // unknown category tempId
      { name: 'L', categories: [], gear: [{ tempId: 'g0', name: 'X', category: { kind: 'new', tempId: 'ghost' } }], items: [{ gear: { kind: 'new', tempId: 'g0' }, sortOrder: 0 }] },
      // declared category nothing references
      { name: 'L', categories: [{ tempId: 'c0', name: 'Orphan' }], gear: [], items: [existingItem] },
      // duplicate category tempIds
      { name: 'L', categories: [{ tempId: 'dup', name: 'A' }, { tempId: 'dup', name: 'B' }], gear: [{ tempId: 'g0', name: 'X', category: { kind: 'new', tempId: 'dup' } }], items: [{ gear: { kind: 'new', tempId: 'g0' }, sortOrder: 0 }] },
      // duplicate gear tempIds
      { name: 'L', categories: [], gear: [{ tempId: 'dup', name: 'A' }, { tempId: 'dup', name: 'B' }], items: [{ gear: { kind: 'new', tempId: 'dup' }, sortOrder: 0 }] },
      // worn + consumable both true
      { name: 'L', categories: [], gear: [], items: [{ gear: { kind: 'existing', id: gearId }, isWorn: true, isConsumable: true, sortOrder: 0 }] },
      // quantity bounds
      { name: 'L', categories: [], gear: [], items: [{ gear: { kind: 'existing', id: gearId }, quantity: 0, sortOrder: 0 }] },
      { name: 'L', categories: [], gear: [], items: [{ gear: { kind: 'existing', id: gearId }, quantity: 10000, sortOrder: 0 }] },
      // duplicate sortOrders
      { name: 'L', categories: [], gear: [], items: [{ gear: { kind: 'existing', id: gearId }, sortOrder: 0 }, { gear: { kind: 'existing', id: gearId }, sortOrder: 0 }] },
      // no items
      { name: 'L', categories: [], gear: [], items: [] },
      // over the item cap
      { name: 'L', categories: [], gear: [], items: Array.from({ length: 301 }, (_, i) => ({ gear: { kind: 'existing', id: gearId }, sortOrder: i })) },
      // unknown field
      { name: 'L', categories: [], gear: [], items: [existingItem], extra: 1 },
    ]) {
      const res = await apiRequest(cookie, 'POST', '/api/lists/import', body)
      expect(res.status, JSON.stringify(body).slice(0, 100)).toBe(400)
    }
    expect(await getLists(cookie)).toHaveLength(0)
  })

  it('slugs are unique at the DB level with the matcher-visible error shape', async () => {
    const { cookie } = await signUpVerifiedUser('lists-slug@example.com', 'S')
    const userId = await userIdFor(cookie)
    await testDb.prepare(
      `insert into lists (id, user_id, name, slug, is_shared, is_draft, sort_order, created_at, updated_at) values ('slug-1', '${userId}', 'One', 'AAAAAA', 0, 1, 0, 0, 0)`,
    ).run()
    // Pins the real error text isUniqueViolation matches on.
    await expect(
      testDb.prepare(
        `insert into lists (id, user_id, name, slug, is_shared, is_draft, sort_order, created_at, updated_at) values ('slug-2', '${userId}', 'Two', 'AAAAAA', 0, 1, 1, 0, 0)`,
      ).run(),
    ).rejects.toThrow(/UNIQUE constraint failed: lists.slug/)
  })
})

// Replacing a share link is a PREFERENCE, not a security control. People paste
// these URLs somewhere they cannot easily edit later, so the plain share toggle
// must never retarget them - that is what this separate action is for.
describe('replacing the share link', () => {
  async function shareLinkFor(cookie: string, name: string) {
    const list = await createList(cookie, name)
    const shared = await apiRequest(cookie, 'PATCH', `/api/lists/${list.id}`, {
      isShared: true,
    })
    expect(shared.status).toBe(200)
    return (await shared.json()) as { id: string; slug: string; isShared: boolean }
  }

  it('mints a new slug and leaves the old one resolving nothing', async () => {
    const { cookie } = await signUpVerifiedUser('rotate-basic@example.com', 'R')
    const before = await shareLinkFor(cookie, 'Trip')

    // The old link works while it is the current one.
    expect((await apiRequest(null, 'GET', `/api/shares/v2/${before.slug}`)).status).toBe(200)

    const res = await apiRequest(cookie, 'POST', `/api/lists/${before.id}/share-link`)
    expect(res.status).toBe(200)
    const after = (await res.json()) as { slug: string; isShared: boolean }

    expect(after.slug).not.toBe(before.slug)
    expect(after.slug).toHaveLength(6)

    // The old link is now simply an unknown slug. Same 404 an invented one
    // gets - nothing tells a stranger the pack ever existed.
    const stale = await apiRequest(null, 'GET', `/api/shares/v2/${before.slug}`)
    expect(stale.status).toBe(404)
    const invented = await apiRequest(null, 'GET', '/api/shares/v2/zzzzzz')
    expect(stale.status).toBe(invented.status)
    expect(await stale.json()).toEqual(await invented.json())

    // ...and the new one serves the same list.
    expect((await apiRequest(null, 'GET', `/api/shares/v2/${after.slug}`)).status).toBe(200)
  })

  it('does not touch sharing either way', async () => {
    const { cookie } = await signUpVerifiedUser('rotate-flag@example.com', 'R')

    // Public stays public.
    const pub = await shareLinkFor(cookie, 'Public trip')
    const rotatedPub = await apiRequest(cookie, 'POST', `/api/lists/${pub.id}/share-link`)
    expect(((await rotatedPub.json()) as { isShared: boolean }).isShared).toBe(true)

    // Private stays private - and the fresh slug is NOT quietly live.
    const priv = await createList(cookie, 'Private trip')
    const rotatedPriv = await apiRequest(cookie, 'POST', `/api/lists/${priv.id}/share-link`)
    expect(rotatedPriv.status).toBe(200)
    const body = (await rotatedPriv.json()) as { slug: string; isShared: boolean }
    expect(body.isShared).toBe(false)
    expect((await apiRequest(null, 'GET', `/api/shares/v2/${body.slug}`)).status).toBe(404)
  })

  // The retry on a slug collision is unreachable from here - two 6-char base62
  // draws colliding is ~1-in-2^35 - so it is tested directly against
  // withFreshSlug in server/repos/lists-slug.node.test.ts.
})
