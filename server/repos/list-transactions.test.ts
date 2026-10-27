import { env } from '../test/node-env'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDb } from '../db'
import { apiRequest } from '../test/api-helpers'
import { signUpVerifiedUser } from '../test/auth-helpers'
import { PACK_RANK_MAX } from '../../shared/lists'
import { createListItemsRepo } from './list-items'
import { createListsRepo } from './lists'
import { createPackingLocationsRepo } from './packing-locations'

// Lists and list items run each operation as ONE SQLite transaction
// (server/repos/lists.ts, list-items.ts). These tests prove that through the
// real API and the real repositories:
//
// - a failure injected AFTER some of an operation's writes have run leaves
//   no trace of any of them;
// - a constraint failure, a pack-rank collision on a move included, is a
//   redacted 500;
// - a write that lands while another operation is in progress cannot split
//   it: the operations run one after the other;
// - a write's response is the row it committed;
// - refused writes by another user or an anonymous caller change no row.
//
// Failures are test-only triggers and indexes, created in this file's own
// database and dropped after each test. Nothing about the transaction or the
// rollback is mocked.

const sqlite = env.DB
let consoleError: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  // The injected failures are unclassified errors, so the app logs a 500.
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  consoleError.mockRestore()
  vi.restoreAllMocks()
  sqlite.exec('DROP TRIGGER IF EXISTS test_inject_failure')
  sqlite.exec('DROP INDEX IF EXISTS test_only_unique')
})

type ListBody = { id: string; name: string; slug: string; sortOrder: number }
type ItemBody = {
  id: string
  gearItemId: string
  sortOrder: number
  packSortOrder: number
  packingLocationId: string | null
  isPacked: boolean
  isReady: boolean
}

let users = 0
async function newUser() {
  users += 1
  const { cookie } = await signUpVerifiedUser(`list-tx-${users}@example.com`, 'Tx')
  const me = (await (await apiRequest(cookie, 'GET', '/api/me')).json()) as { id: string }
  return { cookie, userId: me.id }
}

async function post<T>(cookie: string, path: string, body?: unknown, status = 201): Promise<T> {
  const res = await apiRequest(cookie, 'POST', path, body)
  expect(res.status, path).toBe(status)
  return (await res.json()) as T
}

const createList = (cookie: string, name = 'Trip') =>
  post<ListBody>(cookie, '/api/lists', { name })
const createGear = (cookie: string, name: string) =>
  post<{ id: string }>(cookie, '/api/gear-items', { name, weightGrams: 100 }).then((g) => g.id)
const addItem = (cookie: string, listId: string, gearItemId: string) =>
  post<ItemBody>(cookie, `/api/lists/${listId}/items`, { gearItemId })
const createLocation = (cookie: string, listId: string, name = 'Bag') =>
  post<{ id: string }>(cookie, `/api/lists/${listId}/packing-locations`, { name }).then((l) => l.id)

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

// Every row one user owns, read directly (no app code), in a stable order,
// so a before/after comparison catches any write at all.
const OWNED_TABLES = [
  'lists',
  'list_items',
  'gear_items',
  'categories',
  'packing_locations',
  'list_food_slots',
  'list_food_items',
  'list_food_item_slots',
] as const
function snapshot(userId: string) {
  return Object.fromEntries(
    OWNED_TABLES.map((table) => [
      table,
      sqlite.prepare(`select * from ${table} where user_id = ? order by rowid`).all(userId),
    ]),
  )
}

function injectFailure(sql: string) {
  sqlite.exec(sql)
}

// A list with two gear items (one in a bag), a day of food and one scheduled
// food item: something in every table a duplicate copies.
async function seedFullList(cookie: string) {
  const list = await createList(cookie)
  const bag = await createLocation(cookie, list.id)
  const first = await addItem(cookie, list.id, await createGear(cookie, 'Tent'))
  await addItem(cookie, list.id, await createGear(cookie, 'Stove'))
  const moved = await apiRequest(cookie, 'PATCH', `/api/lists/${list.id}/items/${first.id}`, {
    packingLocationId: bag,
    isPacked: true,
  })
  expect(moved.status).toBe(200)
  const days = await apiRequest(cookie, 'PUT', `/api/lists/${list.id}/food/days`, { days: 1 })
  const food = (await days.json()) as { slots: { id: string }[] }
  await post(cookie, `/api/lists/${list.id}/food/items`, {
    name: 'Oats',
    weightGrams: 90,
    quantity: 1,
    slotIds: [food.slots[0]!.id],
  })
  return { list, bag }
}

describe('every multi-write list operation is all-or-nothing', () => {
  it('duplicate: a failure at the last food association rolls back the whole copy', async () => {
    const { cookie, userId } = await newUser()
    const { list } = await seedFullList(cookie)
    const before = snapshot(userId)
    // The copy's food associations are its last writes: by then the list,
    // the bag, both items and the food slot and item have been inserted.
    injectFailure(`
      CREATE TRIGGER test_inject_failure BEFORE INSERT ON list_food_item_slots
      WHEN NEW.list_id <> '${list.id}'
      BEGIN SELECT RAISE(ABORT, 'test: injected failure'); END
    `)

    const res = await apiRequest(cookie, 'POST', `/api/lists/${list.id}/duplicate`)
    expect(res.status).toBe(500)
    expect(snapshot(userId)).toEqual(before)

    // The same request succeeds once the failure is gone, so the rollback
    // above was not a validation refusal.
    sqlite.exec('DROP TRIGGER test_inject_failure')
    const copy = await post<ListBody>(cookie, `/api/lists/${list.id}/duplicate`)
    for (const table of ['list_items', 'packing_locations', 'list_food_items', 'list_food_item_slots']) {
      const count = (listId: string) =>
        (sqlite.prepare(`select count(*) as n from ${table} where list_id = ?`).get(listId) as { n: number }).n
      expect(count(copy.id), table).toBe(count(list.id))
    }
  })

  it('import: a failure at the last item rolls back the list, categories and gear', async () => {
    const { cookie, userId } = await newUser()
    const existingGear = await createGear(cookie, 'Old tarp')
    const before = snapshot(userId)
    injectFailure(`
      CREATE TRIGGER test_inject_failure BEFORE INSERT ON list_items
      WHEN NEW.sort_order = 2
      BEGIN SELECT RAISE(ABORT, 'test: injected failure'); END
    `)
    const body = {
      name: 'Imported',
      categories: [{ tempId: 'c1', name: 'Shelter' }],
      gear: [
        {
          tempId: 'g1',
          name: 'New tent',
          description: null,
          weightGrams: 900,
          category: { kind: 'new', tempId: 'c1' },
          cost: null,
        },
      ],
      items: [
        { gear: { kind: 'new', tempId: 'g1' }, quantity: 1, isWorn: false, isConsumable: false, sortOrder: 0 },
        { gear: { kind: 'existing', id: existingGear }, quantity: 1, isWorn: false, isConsumable: false, sortOrder: 2 },
      ],
    }

    expect((await apiRequest(cookie, 'POST', '/api/lists/import', body)).status).toBe(500)
    expect(snapshot(userId)).toEqual(before)

    sqlite.exec('DROP TRIGGER test_inject_failure')
    await post(cookie, '/api/lists/import', body)
  })

  it('from-selection: a failure at the last item rolls back the list and every item', async () => {
    const { cookie, userId } = await newUser()
    const gear = [
      await createGear(cookie, 'A'),
      await createGear(cookie, 'B'),
      await createGear(cookie, 'C'),
    ]
    const before = snapshot(userId)
    injectFailure(`
      CREATE TRIGGER test_inject_failure BEFORE INSERT ON list_items
      WHEN NEW.gear_item_id = '${gear[2]}'
      BEGIN SELECT RAISE(ABORT, 'test: injected failure'); END
    `)

    const body = { name: 'Picked', gearItemIds: gear }
    expect((await apiRequest(cookie, 'POST', '/api/lists/from-selection', body)).status).toBe(500)
    expect(snapshot(userId)).toEqual(before)
  })

  it('list reorder: a failure at the last list restores every position', async () => {
    const { cookie, userId } = await newUser()
    const lists = [await createList(cookie, 'A'), await createList(cookie, 'B'), await createList(cookie, 'C')]
    const before = snapshot(userId)
    injectFailure(`
      CREATE TRIGGER test_inject_failure BEFORE UPDATE OF sort_order ON lists
      WHEN NEW.id = '${lists[2]!.id}'
      BEGIN SELECT RAISE(ABORT, 'test: injected failure'); END
    `)

    const order = lists.map((l, i) => ({ id: l.id, sortOrder: 10 - i }))
    expect((await apiRequest(cookie, 'PUT', '/api/lists/order', order)).status).toBe(500)
    expect(snapshot(userId)).toEqual(before)
  })

  it('quick-add: a failure at the membership row removes the new gear too', async () => {
    const { cookie, userId } = await newUser()
    const list = await createList(cookie)
    const before = snapshot(userId)
    injectFailure(`
      CREATE TRIGGER test_inject_failure BEFORE INSERT ON list_items
      BEGIN SELECT RAISE(ABORT, 'test: injected failure'); END
    `)

    const res = await apiRequest(cookie, 'POST', `/api/lists/${list.id}/items/quick-add`, {
      name: 'Headlamp',
    })
    expect(res.status).toBe(500)
    expect(snapshot(userId)).toEqual(before)
  })

  it('item reorder: a failure at the last item restores every position', async () => {
    const { cookie, userId } = await newUser()
    const list = await createList(cookie)
    const items = [
      await addItem(cookie, list.id, await createGear(cookie, 'A')),
      await addItem(cookie, list.id, await createGear(cookie, 'B')),
      await addItem(cookie, list.id, await createGear(cookie, 'C')),
    ]
    const before = snapshot(userId)
    injectFailure(`
      CREATE TRIGGER test_inject_failure BEFORE UPDATE OF sort_order ON list_items
      WHEN NEW.id = '${items[2]!.id}'
      BEGIN SELECT RAISE(ABORT, 'test: injected failure'); END
    `)

    const order = items.map((item, i) => ({ id: item.id, sortOrder: 10 - i }))
    const res = await apiRequest(cookie, 'PUT', `/api/lists/${list.id}/items/order`, order)
    expect(res.status).toBe(500)
    expect(snapshot(userId)).toEqual(before)
  })

  for (const [route, column] of [
    ['reset-packed', 'is_packed'],
    ['reset-ready', 'is_ready'],
  ] as const) {
    it(`${route}: a failure clearing food keeps the gear flags set`, async () => {
      const { cookie, userId } = await newUser()
      const list = await createList(cookie)
      const item = await addItem(cookie, list.id, await createGear(cookie, 'Tent'))
      const food = await post<{ id: string }>(cookie, `/api/lists/${list.id}/food/items`, {
        name: 'Oats',
        weightGrams: 90,
        quantity: 1,
        slotIds: [],
      })
      expect(
        (await apiRequest(cookie, 'PATCH', `/api/lists/${list.id}/items/${item.id}`, {
          isPacked: true,
          isReady: true,
        })).status,
      ).toBe(200)
      expect(
        (await apiRequest(cookie, 'PATCH', `/api/lists/${list.id}/food/items/${food.id}`, {
          isPacked: true,
          isReady: true,
        })).status,
      ).toBe(200)
      const before = snapshot(userId)
      // Gear is cleared first, food second.
      injectFailure(`
        CREATE TRIGGER test_inject_failure BEFORE UPDATE OF ${column} ON list_food_items
        BEGIN SELECT RAISE(ABORT, 'test: injected failure'); END
      `)

      const res = await apiRequest(cookie, 'POST', `/api/lists/${list.id}/items/${route}`)
      expect(res.status).toBe(500)
      expect(snapshot(userId)).toEqual(before)
    })
  }
})

describe('list and list-item error classification', () => {
  async function moverAndResident(cookie: string) {
    const list = await createList(cookie)
    const bag = await createLocation(cookie, list.id)
    const resident = await addItem(cookie, list.id, await createGear(cookie, 'Resident'))
    const placed = await apiRequest(cookie, 'PATCH', `/api/lists/${list.id}/items/${resident.id}`, {
      packingLocationId: bag,
    })
    expect(placed.status).toBe(200)
    const mover = await addItem(cookie, list.id, await createGear(cookie, 'Mover'))
    return { list, bag, resident, mover }
  }

  it('a pack-rank collision on a move is a 500 defect, with nothing written', async () => {
    // The destination rank is computed inside the move's own transaction, so
    // nothing can take it first; a collision is a defect. Stage it: just before the mover lands last in the
    // bag, a trigger moves the bag's resident onto that same rank.
    const { cookie, userId } = await newUser()
    const { list, bag, resident, mover } = await moverAndResident(cookie)
    const before = snapshot(userId)
    injectFailure(`
      CREATE TRIGGER test_inject_failure BEFORE UPDATE OF packing_location_id ON list_items
      WHEN NEW.id = '${mover.id}'
      BEGIN
        UPDATE list_items SET pack_sort_order = NEW.pack_sort_order WHERE id = '${resident.id}';
      END
    `)

    const res = await apiRequest(cookie, 'PATCH', `/api/lists/${list.id}/items/${mover.id}`, {
      packingLocationId: bag,
      quantity: 3,
    })
    expect(res.status).toBe(500)
    expect(snapshot(userId)).toEqual(before)
  })

  it('a pack-rank collision on an arrival stays a 500, as it always was', async () => {
    // Adding never mapped a rank collision to 409. Keeping it that way: the
    // conversion narrows the 409, it does not add new ones.
    const { cookie, userId } = await newUser()
    const list = await createList(cookie)
    const existing = await addItem(cookie, list.id, await createGear(cookie, 'Existing'))
    const gear = await createGear(cookie, 'Arrival')
    const before = snapshot(userId)
    injectFailure(`
      CREATE TRIGGER test_inject_failure BEFORE INSERT ON list_items
      WHEN NEW.list_id = '${list.id}'
      BEGIN
        UPDATE list_items SET pack_sort_order = NEW.pack_sort_order WHERE id = '${existing.id}';
      END
    `)

    const res = await apiRequest(cookie, 'POST', `/api/lists/${list.id}/items`, { gearItemId: gear })
    expect(res.status).toBe(500)
    expect(snapshot(userId)).toEqual(before)
  })

  it('a full rank space is the route 422 on an add and on a move, with nothing written', async () => {
    const { cookie, userId } = await newUser()
    const { list, bag, resident, mover } = await moverAndResident(cookie)
    // Both cohorts sit at the top of the rank space, so any arrival's
    // max + 1 trips the range trigger.
    sqlite.prepare('update list_items set pack_sort_order = ? where id = ?').run(PACK_RANK_MAX, resident.id)
    sqlite.prepare('update list_items set pack_sort_order = ? where id = ?').run(PACK_RANK_MAX, mover.id)
    const gear = await createGear(cookie, 'Arrival')
    const before = snapshot(userId)
    const message = {
      error: 'This packing group has run out of ordering space. Move some items to another group.',
    }

    const add = await apiRequest(cookie, 'POST', `/api/lists/${list.id}/items`, { gearItemId: gear })
    expect(add.status).toBe(422)
    expect(await add.json()).toEqual(message)
    const move = await apiRequest(cookie, 'PATCH', `/api/lists/${list.id}/items/${mover.id}`, {
      packingLocationId: bag,
      quantity: 3,
    })
    expect(move.status).toBe(422)
    expect(await move.json()).toEqual(message)
    expect(snapshot(userId)).toEqual(before)
  })

  it('any OTHER unique failure is a redacted 500, never a retryable 409', async () => {
    // A unique index that is not a pack-rank index: quantity 4321 may appear
    // once in the whole table, and another user's item holds it. Retrying
    // cannot fix that.
    const other = await newUser()
    const otherList = await createList(other.cookie)
    const otherItem = await addItem(other.cookie, otherList.id, await createGear(other.cookie, 'Theirs'))
    sqlite.prepare('update list_items set quantity = 4321 where id = ?').run(otherItem.id)
    sqlite.exec(
      'CREATE UNIQUE INDEX test_only_unique ON list_items(quantity) WHERE quantity = 4321',
    )
    const { cookie, userId } = await newUser()
    const list = await createList(cookie)
    const item = await addItem(cookie, list.id, await createGear(cookie, 'Mine'))
    const before = snapshot(userId)

    const res = await apiRequest(cookie, 'PATCH', `/api/lists/${list.id}/items/${item.id}`, {
      quantity: 4321,
      isPacked: true,
    })
    expect(res.status).toBe(500)
    const text = await res.text()
    expect(text).not.toContain('UNIQUE')
    expect(text).not.toContain('4321')
    expect(text).not.toContain(item.id)
    expect(snapshot(userId)).toEqual(before)
  })

  it('a list write tripping an unrelated unique index is a 500 and writes nothing', async () => {
    const other = await newUser()
    await createList(other.cookie, 'Only once')
    sqlite.exec(`CREATE UNIQUE INDEX test_only_unique ON lists(name) WHERE name = 'Only once'`)
    const { cookie, userId } = await newUser()
    const gear = await createGear(cookie, 'Tent')
    const before = snapshot(userId)

    for (const [path, body] of [
      ['/api/lists', { name: 'Only once' }],
      ['/api/lists/from-selection', { name: 'Only once', gearItemIds: [gear] }],
    ] as const) {
      const res = await apiRequest(cookie, 'POST', path, body)
      expect(res.status, path).toBe(500)
      expect(await res.text(), path).not.toContain('Only once')
    }
    expect(snapshot(userId)).toEqual(before)
  })

  it('a slug collision retries the whole duplicate and leaves one complete copy', async () => {
    // Force the first slug drawn to be one that already exists. The
    // collision aborts that attempt's transaction; the retry draws again.
    const { cookie, userId } = await newUser()
    const { list } = await seedFullList(cookie)
    const taken = list.slug
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
    const real = crypto.getRandomValues.bind(crypto)
    let forced = false
    vi.spyOn(crypto, 'getRandomValues').mockImplementation(<T extends ArrayBufferView | null>(array: T): T => {
      if (!forced && array instanceof Uint8Array && array.length === 6) {
        forced = true
        array.set([...taken].map((ch) => alphabet.indexOf(ch)))
        return array
      }
      return real(array as never) as T
    })

    const result = await createListsRepo(createDb(sqlite), userId).duplicate(list.id)
    expect(forced).toBe(true)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.row.slug).not.toBe(taken)
    expect(
      (sqlite.prepare('select count(*) as n from lists where user_id = ?').get(userId) as { n: number }).n,
    ).toBe(2)
    expect(
      (sqlite.prepare('select count(*) as n from list_items where list_id = ?').get(result.row.id) as { n: number }).n,
    ).toBe(2)
  })
})

describe('overlapping list operations', () => {
  // Each call below starts a repository operation, then - in the same tick -
  // makes a direct write that would break it if it landed in the middle. A
  // repository whose read, checks and write are one synchronous transaction
  // has already committed by then; code that awaited between its checks and
  // its write let the direct write in between (and answered 400 or 500).
  const repos = (userId: string) => {
    const db = createDb(sqlite)
    return {
      lists: createListsRepo(db, userId),
      items: createListItemsRepo(db, userId),
      locations: createPackingLocationsRepo(db, userId),
    }
  }
  const deleteRow = (table: string, id: string) =>
    (async () => {
      sqlite.prepare(`delete from ${table} where id = ?`).run(id)
    })()

  it('adding gear while that gear is deleted: the add lands whole, then the delete cascades it', async () => {
    const { cookie, userId } = await newUser()
    const list = await createList(cookie)
    const gear = await createGear(cookie, 'Tent')
    const [added] = await Promise.all([
      repos(userId).items.addExisting(list.id, gear),
      deleteRow('gear_items', gear),
    ])
    expect(added.ok).toBe(true)
    expect(await getItems(cookie, list.id)).toEqual([])
  })

  it('quick-add while the list is deleted: gear and item land whole, then the delete cascades the item', async () => {
    const { cookie, userId } = await newUser()
    const list = await createList(cookie)
    const [added] = await Promise.all([
      repos(userId).items.quickAdd(list.id, {
        name: 'Tent',
        description: null,
        weightGrams: 900,
        categoryId: null,
        quantity: 1,
        isWorn: false,
        isConsumable: false,
      }),
      deleteRow('lists', list.id),
    ])
    expect(added.ok).toBe(true)
    if (!added.ok) return
    // The gear stays in the library; the membership went with the list.
    expect(sqlite.prepare('select 1 from gear_items where id = ?').get(added.row.gear.id)).toBeDefined()
    expect(sqlite.prepare('select 1 from list_items where id = ?').get(added.row.item.id)).toBeUndefined()
  })

  it('from-selection while a selected gear is deleted: the list lands whole', async () => {
    const { cookie, userId } = await newUser()
    const gear = [await createGear(cookie, 'A'), await createGear(cookie, 'B')]
    const [created] = await Promise.all([
      repos(userId).lists.createFromSelection('Picked', null, gear),
      deleteRow('gear_items', gear[1]!),
    ])
    expect(created.ok).toBe(true)
    if (!created.ok) return
    // The list committed with both items; the delete then cascaded B's.
    expect((await getItems(cookie, created.row.id)).map((i) => i.gearItemId)).toEqual([gear[0]])
  })

  it('import while referenced gear is deleted: the import lands whole', async () => {
    const { cookie, userId } = await newUser()
    const gear = await createGear(cookie, 'Old tarp')
    const [imported] = await Promise.all([
      repos(userId).lists.importFromCsv({
        name: 'Imported',
        categories: [],
        gear: [],
        items: [
          {
            gear: { kind: 'existing', id: gear },
            quantity: 1,
            isWorn: false,
            isConsumable: false,
            sortOrder: 0,
          },
        ],
      }),
      deleteRow('gear_items', gear),
    ])
    expect(imported.ok).toBe(true)
  })

  it('moving an item into a bag while the bag is deleted: the move lands, then the delete unassigns it', async () => {
    const { cookie, userId } = await newUser()
    const list = await createList(cookie)
    const bag = await createLocation(cookie, list.id)
    const item = await addItem(cookie, list.id, await createGear(cookie, 'Tent'))
    const r = repos(userId)
    const [moved, removed] = await Promise.all([
      r.items.update(list.id, item.id, { packingLocationId: bag }),
      r.locations.remove(list.id, bag),
    ])
    expect(moved).toMatchObject({ ok: true, row: { item: { packingLocationId: bag } } })
    expect(removed).toBe('deleted')
    expect((await getItems(cookie, list.id))[0]?.packingLocationId).toBeNull()
  })

  it('five adds at once each get their own list position and pack rank', async () => {
    const { cookie, userId } = await newUser()
    const list = await createList(cookie)
    const gear = []
    for (const name of ['A', 'B', 'C', 'D', 'E']) gear.push(await createGear(cookie, name))
    const r = repos(userId)
    const results = await Promise.all(gear.map((g) => r.items.addExisting(list.id, g)))
    const rows = results.map((result) => {
      if (!result.ok) throw new Error(`add failed: ${result.reason}`)
      return result.row.item
    })
    expect(rows.map((row) => row.sortOrder)).toEqual([0, 1, 2, 3, 4])
    expect(rows.map((row) => row.packSortOrder)).toEqual([0, 1, 2, 3, 4])
  })
})

describe('write responses are what committed', () => {
  it('item PATCH, add and quick-add answer with the stored row', async () => {
    const { cookie } = await newUser()
    const list = await createList(cookie)
    const bag = await createLocation(cookie, list.id)
    const added = await addItem(cookie, list.id, await createGear(cookie, 'Tent'))
    const quick = await post<ItemBody>(cookie, `/api/lists/${list.id}/items/quick-add`, {
      name: 'Headlamp',
      quantity: 2,
    })
    const patched = await apiRequest(cookie, 'PATCH', `/api/lists/${list.id}/items/${added.id}`, {
      packingLocationId: bag,
      quantity: 4,
      isReady: true,
    })
    expect(patched.status).toBe(200)
    const patchedBody = (await patched.json()) as ItemBody

    const stored = await getItems(cookie, list.id)
    expect(stored.find((i) => i.id === added.id)).toEqual(patchedBody)
    expect(stored.find((i) => i.id === quick.id)).toEqual(quick)
  })

  it('create, duplicate, from-selection and import answer with the stored list', async () => {
    const { cookie } = await newUser()
    const { list } = await seedFullList(cookie)
    const gear = await createGear(cookie, 'Picked')
    const answers = [
      list,
      await post<ListBody>(cookie, `/api/lists/${list.id}/duplicate`),
      await post<ListBody>(cookie, '/api/lists/from-selection', { name: 'Sel', gearItemIds: [gear] }),
      await post<ListBody>(cookie, '/api/lists/import', {
        name: 'Imp',
        categories: [],
        gear: [],
        items: [{ gear: { kind: 'existing', id: gear }, quantity: 1, isWorn: false, isConsumable: false, sortOrder: 0 }],
      }),
    ]
    const stored = await getLists(cookie)
    for (const answer of answers) expect(stored.find((l) => l.id === answer.id)).toEqual(answer)
    // Each new list takes the next position.
    expect(answers.map((a) => a.sortOrder)).toEqual([0, 1, 2, 3])
  })
})

describe('refused list writes change nothing', () => {
  it('another user and an anonymous caller: every write is refused and no row moves', async () => {
    const owner = await newUser()
    const { list, bag } = await seedFullList(owner.cookie)
    const [item] = await getItems(owner.cookie, list.id)
    const intruder = await newUser()
    const intruderList = await createList(intruder.cookie)
    const intruderItem = await addItem(intruder.cookie, intruderList.id, await createGear(intruder.cookie, 'X'))
    const ownerGear = item!.gearItemId
    const before = { owner: snapshot(owner.userId), intruder: snapshot(intruder.userId) }

    const writes = [
      ['PATCH', `/api/lists/${list.id}`, { name: 'Stolen' }, 404],
      ['DELETE', `/api/lists/${list.id}`, undefined, 404],
      ['POST', `/api/lists/${list.id}/duplicate`, undefined, 404],
      ['POST', `/api/lists/${list.id}/share-link`, undefined, 404],
      ['PUT', '/api/lists/order', [{ id: list.id, sortOrder: 9 }], 404],
      ['POST', `/api/lists/${list.id}/items`, { gearItemId: ownerGear }, 404],
      ['POST', `/api/lists/${list.id}/items/quick-add`, { name: 'X' }, 404],
      ['PUT', `/api/lists/${list.id}/items/order`, [{ id: item!.id, sortOrder: 9 }], 404],
      ['POST', `/api/lists/${list.id}/items/reset-packed`, undefined, 404],
      ['POST', `/api/lists/${list.id}/items/reset-ready`, undefined, 404],
      ['PATCH', `/api/lists/${list.id}/items/${item!.id}`, { quantity: 9 }, 404],
      ['DELETE', `/api/lists/${list.id}/items/${item!.id}`, undefined, 404],
      // Wrong parent: the intruder's own item, the owner's bag.
      ['PATCH', `/api/lists/${intruderList.id}/items/${intruderItem.id}`, { packingLocationId: bag }, 400],
      // The intruder's own list, the owner's gear.
      ['POST', `/api/lists/${intruderList.id}/items`, { gearItemId: ownerGear }, 400],
      ['POST', '/api/lists/from-selection', { name: 'X', gearItemIds: [ownerGear] }, 400],
    ] as const
    for (const [method, path, body, status] of writes) {
      const res = await apiRequest(intruder.cookie, method, path, body)
      expect(res.status, `${method} ${path}`).toBe(status)
      const anon = await apiRequest(null, method, path, body)
      expect(anon.status, `anon ${method} ${path}`).toBe(401)
    }
    expect({ owner: snapshot(owner.userId), intruder: snapshot(intruder.userId) }).toEqual(before)
  })
})
