import { env } from '../test/node-env'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiRequest } from '../test/api-helpers'
import { signUpVerifiedUser } from '../test/auth-helpers'
import type { FoodItemResponse, ListFoodResponse } from '../../shared/food'
import { createDb } from '../db'
import { createFoodRepo } from './food'
import { PACK_RANK_MAX } from '../../shared/lists'

// The food estimate runs each operation as ONE SQLite transaction
// (server/repos/food.ts). These tests prove that through the real API:
//
// - a failure injected AFTER some of an operation's writes have run leaves
//   no trace of any of them;
// - a constraint failure, a pack-rank collision included, is a 500;
// - overlapping requests run one after the other and leave consistent data.
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
  sqlite.exec('DROP TRIGGER IF EXISTS test_inject_failure')
  sqlite.exec('DROP INDEX IF EXISTS test_only_name')
})

let users = 0
async function seedList(days: number) {
  users += 1
  const { cookie } = await signUpVerifiedUser(`food-tx-${users}@example.com`, 'Tx')
  const res = await apiRequest(cookie, 'POST', '/api/lists', { name: 'Trip' })
  expect(res.status).toBe(201)
  const listId = ((await res.json()) as { id: string }).id
  if (days > 0) expect((await setDays(cookie, listId, days)).status).toBe(200)
  return { cookie, listId }
}

function setDays(cookie: string, listId: string, days: number) {
  return apiRequest(cookie, 'PUT', `/api/lists/${listId}/food/days`, { days })
}

async function getFood(cookie: string, listId: string): Promise<ListFoodResponse> {
  const res = await apiRequest(cookie, 'GET', `/api/lists/${listId}/food`)
  expect(res.status).toBe(200)
  return (await res.json()) as ListFoodResponse
}

async function addItem(
  cookie: string,
  listId: string,
  body: { name: string; slotIds: string[] },
): Promise<FoodItemResponse> {
  const res = await apiRequest(cookie, 'POST', `/api/lists/${listId}/food/items`, {
    weightGrams: 100,
    quantity: 1,
    ...body,
  })
  expect(res.status).toBe(201)
  return (await res.json()) as FoodItemResponse
}

function slotId(food: ListFoodResponse, day: number, meal: string): string {
  const slot = food.slots.find((s) => s.dayNumber === day && s.meal === meal)
  if (!slot) throw new Error(`no slot for day ${day} ${meal}`)
  return slot.id
}

// Every food row of one list, read directly (no user predicate), in a stable
// order, so a before/after comparison catches any write at all.
function foodRows(listId: string) {
  return {
    slots: sqlite
      .prepare('select * from list_food_slots where list_id = ? order by day_number, meal')
      .all(listId),
    items: sqlite
      .prepare('select * from list_food_items where list_id = ? order by id')
      .all(listId),
    links: sqlite
      .prepare(
        'select * from list_food_item_slots where list_id = ? order by food_item_id, slot_id',
      )
      .all(listId),
  }
}

function injectFailure(sql: string) {
  sqlite.exec(sql)
}

describe('every food write is all-or-nothing', () => {
  it('create: a failure at the last association rolls back the item and its other links', async () => {
    const { cookie, listId } = await seedList(2)
    const food = await getFood(cookie, listId)
    const slots = [slotId(food, 1, 'breakfast'), slotId(food, 1, 'lunch'), slotId(food, 2, 'dinner')]
    const before = foodRows(listId)
    injectFailure(`
      CREATE TRIGGER test_inject_failure BEFORE INSERT ON list_food_item_slots
      WHEN NEW.slot_id = '${slots[2]}'
      BEGIN SELECT RAISE(ABORT, 'test: injected failure'); END
    `)

    const body = { name: 'Couscous', weightGrams: 120, quantity: 1, slotIds: slots }
    const res = await apiRequest(cookie, 'POST', `/api/lists/${listId}/food/items`, body)
    expect(res.status).toBe(500)
    expect(foodRows(listId)).toEqual(before)

    // The same request succeeds once the failure is gone, so the rollback
    // above was not a validation refusal.
    sqlite.exec('DROP TRIGGER test_inject_failure')
    const retry = await apiRequest(cookie, 'POST', `/api/lists/${listId}/food/items`, body)
    expect(retry.status).toBe(201)
    expect(((await retry.json()) as FoodItemResponse).slotIds).toEqual(slots)
  })

  it('update: a failure while inserting the new links restores the scalars and the old links', async () => {
    const { cookie, listId } = await seedList(2)
    const food = await getFood(cookie, listId)
    const item = await addItem(cookie, listId, {
      name: 'Oats',
      slotIds: [slotId(food, 1, 'breakfast')],
    })
    const target = [slotId(food, 2, 'breakfast'), slotId(food, 2, 'lunch')]
    const before = foodRows(listId)
    // By the time the second new link is inserted, the scalar update, the
    // delete of the old link and the first new link have all run.
    injectFailure(`
      CREATE TRIGGER test_inject_failure BEFORE INSERT ON list_food_item_slots
      WHEN NEW.slot_id = '${target[1]}'
      BEGIN SELECT RAISE(ABORT, 'test: injected failure'); END
    `)

    const patch = { name: 'Renamed', quantity: 3, slotIds: target }
    const path = `/api/lists/${listId}/food/items/${item.id}`
    expect((await apiRequest(cookie, 'PATCH', path, patch)).status).toBe(500)
    expect(foodRows(listId)).toEqual(before)

    sqlite.exec('DROP TRIGGER test_inject_failure')
    const retry = await apiRequest(cookie, 'PATCH', path, patch)
    expect(retry.status).toBe(200)
    expect(await retry.json()).toMatchObject({ name: 'Renamed', quantity: 3, unitCount: 6 })
  })

  it('days: a failure at the trim rolls back the slots already inserted', async () => {
    // Five days with day 2 missing, then three days: the write first
    // re-inserts day 2 (the hole repair), then trims days 4 and 5.
    const { cookie, listId } = await seedList(5)
    sqlite.prepare('delete from list_food_slots where list_id = ? and day_number = 2').run(listId)
    const before = foodRows(listId)
    expect(before.slots).toHaveLength(12)
    injectFailure(`
      CREATE TRIGGER test_inject_failure BEFORE DELETE ON list_food_slots
      WHEN OLD.list_id = '${listId}'
      BEGIN SELECT RAISE(ABORT, 'test: injected failure'); END
    `)

    expect((await setDays(cookie, listId, 3)).status).toBe(500)
    expect(foodRows(listId)).toEqual(before)

    sqlite.exec('DROP TRIGGER test_inject_failure')
    const retry = await setDays(cookie, listId, 3)
    expect(retry.status).toBe(200)
    const after = (await retry.json()) as ListFoodResponse
    expect(after.dayCount).toBe(3)
    expect(after.slots).toHaveLength(9)
  })

  it('delete: a failure in the cascade keeps the item and every placement', async () => {
    // The item and its placements go in ONE statement (ON DELETE CASCADE),
    // so SQLite undoes this even without the transaction. It pins the result
    // for the one food write that is not several statements.
    const { cookie, listId } = await seedList(1)
    const food = await getFood(cookie, listId)
    const item = await addItem(cookie, listId, {
      name: 'Trail mix',
      slotIds: [slotId(food, 1, 'breakfast'), slotId(food, 1, 'lunch')],
    })
    const before = foodRows(listId)
    injectFailure(`
      CREATE TRIGGER test_inject_failure BEFORE DELETE ON list_food_item_slots
      WHEN OLD.slot_id = '${slotId(food, 1, 'lunch')}'
      BEGIN SELECT RAISE(ABORT, 'test: injected failure'); END
    `)

    const path = `/api/lists/${listId}/food/items/${item.id}`
    expect((await apiRequest(cookie, 'DELETE', path)).status).toBe(500)
    expect(foodRows(listId)).toEqual(before)
  })

  it('a foreign-key failure inside the write is a 500 and undoes everything', async () => {
    // The ownership checks run in the same transaction as the write, so a
    // slot cannot disappear between them; a foreign-key failure can only be
    // a defect. Stage one anyway: a trigger deletes the slot just before its
    // association is inserted. The repo must not explain it away as a client
    // error, and the trigger's own delete must roll back with the rest.
    const { cookie, listId } = await seedList(1)
    const food = await getFood(cookie, listId)
    const doomed = slotId(food, 1, 'dinner')
    const before = foodRows(listId)
    injectFailure(`
      CREATE TRIGGER test_inject_failure BEFORE INSERT ON list_food_item_slots
      WHEN NEW.slot_id = '${doomed}'
      BEGIN DELETE FROM list_food_slots WHERE id = '${doomed}'; END
    `)

    const res = await apiRequest(cookie, 'POST', `/api/lists/${listId}/food/items`, {
      name: 'Couscous',
      weightGrams: 120,
      quantity: 1,
      slotIds: [doomed],
    })
    expect(res.status).toBe(500)
    expect(foodRows(listId)).toEqual(before)
  })
})

describe('food error classification', () => {
  it('create: a pack-rank index collision is a 500 defect, with nothing written', async () => {
    // The arrival rank is computed inside the write's own transaction, so
    // nothing can take it first; a collision is a defect. Stage it: a trigger moves an existing Unassigned
    // food item onto the new row's rank just before the insert.
    const { cookie, listId } = await seedList(0)
    const existing = await addItem(cookie, listId, { name: 'Existing', slotIds: [] })
    const before = foodRows(listId)
    injectFailure(`
      CREATE TRIGGER test_inject_failure BEFORE INSERT ON list_food_items
      WHEN NEW.list_id = '${listId}'
      BEGIN
        UPDATE list_food_items SET pack_sort_order = NEW.pack_sort_order WHERE id = '${existing.id}';
      END
    `)

    const res = await apiRequest(cookie, 'POST', `/api/lists/${listId}/food/items`, {
      name: 'Arrival',
      weightGrams: 100,
      quantity: 1,
      slotIds: [],
    })
    expect(res.status).toBe(500)
    expect(foodRows(listId)).toEqual(before)
  })

  it('update: a pack-rank index collision on a move is a 500 defect, with nothing written', async () => {
    const { cookie, listId } = await seedList(1)
    const food = await getFood(cookie, listId)
    const bagRes = await apiRequest(cookie, 'POST', `/api/lists/${listId}/packing-locations`, {
      name: 'Bag',
    })
    expect(bagRes.status).toBe(201)
    const bag = ((await bagRes.json()) as { id: string }).id
    const resident = await addItem(cookie, listId, { name: 'Resident', slotIds: [] })
    const moved = await apiRequest(cookie, 'PATCH', `/api/lists/${listId}/food/items/${resident.id}`, {
      packingLocationId: bag,
    })
    expect(moved.status).toBe(200)
    const mover = await addItem(cookie, listId, {
      name: 'Mover',
      slotIds: [slotId(food, 1, 'lunch')],
    })
    const before = foodRows(listId)
    // Just before the mover lands last in the bag, move the resident onto
    // that same rank.
    injectFailure(`
      CREATE TRIGGER test_inject_failure BEFORE UPDATE OF packing_location_id ON list_food_items
      WHEN NEW.id = '${mover.id}'
      BEGIN
        UPDATE list_food_items SET pack_sort_order = NEW.pack_sort_order WHERE id = '${resident.id}';
      END
    `)

    const res = await apiRequest(cookie, 'PATCH', `/api/lists/${listId}/food/items/${mover.id}`, {
      name: 'Renamed',
      packingLocationId: bag,
      slotIds: [slotId(food, 1, 'dinner')],
    })
    expect(res.status).toBe(500)
    expect(foodRows(listId)).toEqual(before)
  })

  it('create into a full rank space is the route 422, with nothing written', async () => {
    // An Unassigned food item already holds PACK_RANK_MAX, so the arrival's
    // union max + 1 trips the range trigger.
    const { cookie, listId } = await seedList(0)
    const top = await addItem(cookie, listId, { name: 'Top', slotIds: [] })
    sqlite.prepare('update list_food_items set pack_sort_order = ? where id = ?').run(PACK_RANK_MAX, top.id)
    const before = foodRows(listId)

    const res = await apiRequest(cookie, 'POST', `/api/lists/${listId}/food/items`, {
      name: 'Arrival',
      weightGrams: 100,
      quantity: 1,
      slotIds: [],
    })
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ error: 'This bag cannot accept more items' })
    expect(foodRows(listId)).toEqual(before)
  })

  it('a move into a full bag is the route 422, with nothing written', async () => {
    const { cookie, listId } = await seedList(1)
    const food = await getFood(cookie, listId)
    const bagRes = await apiRequest(cookie, 'POST', `/api/lists/${listId}/packing-locations`, {
      name: 'Full',
    })
    const bag = ((await bagRes.json()) as { id: string }).id
    const resident = await addItem(cookie, listId, { name: 'Resident', slotIds: [] })
    const moved = await apiRequest(cookie, 'PATCH', `/api/lists/${listId}/food/items/${resident.id}`, {
      packingLocationId: bag,
    })
    expect(moved.status).toBe(200)
    sqlite.prepare('update list_food_items set pack_sort_order = ? where id = ?').run(PACK_RANK_MAX, resident.id)
    const mover = await addItem(cookie, listId, {
      name: 'Mover',
      slotIds: [slotId(food, 1, 'lunch')],
    })
    const before = foodRows(listId)

    const res = await apiRequest(cookie, 'PATCH', `/api/lists/${listId}/food/items/${mover.id}`, {
      name: 'Renamed',
      packingLocationId: bag,
      slotIds: [slotId(food, 1, 'dinner')],
    })
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ error: 'This bag cannot accept more items' })
    expect(foodRows(listId)).toEqual(before)
  })

  it('any OTHER unique failure is a 500, not a retryable 409', async () => {
    // A unique index that is not a pack-rank index: the name 'Only once' may
    // appear once in the whole table, and another user's item holds it.
    // Retrying cannot fix that, so neither write may answer it as a conflict.
    const other = await seedList(0)
    await addItem(other.cookie, other.listId, { name: 'Only once', slotIds: [] })
    const { cookie, listId } = await seedList(1)
    const item = await addItem(cookie, listId, { name: 'Mine', slotIds: [] })
    sqlite.exec(
      `CREATE UNIQUE INDEX test_only_name ON list_food_items(name) WHERE name = 'Only once'`,
    )
    const before = foodRows(listId)

    const create = await apiRequest(cookie, 'POST', `/api/lists/${listId}/food/items`, {
      name: 'Only once',
      weightGrams: 100,
      quantity: 1,
      slotIds: [],
    })
    expect(create.status).toBe(500)
    const update = await apiRequest(cookie, 'PATCH', `/api/lists/${listId}/food/items/${item.id}`, {
      name: 'Only once',
    })
    expect(update.status).toBe(500)
    expect(foodRows(listId)).toEqual(before)
  })

  it('the 500 body never carries the database message or bound values', async () => {
    const other = await seedList(0)
    await addItem(other.cookie, other.listId, { name: 'Redaction probe', slotIds: [] })
    const { cookie, listId } = await seedList(0)
    sqlite.exec(
      `CREATE UNIQUE INDEX test_only_name ON list_food_items(name) WHERE name = 'Redaction probe'`,
    )
    const res = await apiRequest(cookie, 'POST', `/api/lists/${listId}/food/items`, {
      name: 'Redaction probe',
      weightGrams: 100,
      quantity: 1,
      slotIds: [],
    })
    expect(res.status).toBe(500)
    const text = await res.text()
    expect(text).not.toContain('UNIQUE')
    expect(text).not.toContain('Redaction probe')
    expect(text).not.toContain(listId)
  })
})

describe('overlapping food operations', () => {
  // These call the repository directly with Promise.all. Each call's
  // transaction runs synchronously, so one finishes before the other starts.
  // Code that awaits between its reads and its write instead interleaves
  // here at every await, which is the overlap these tests are about. (Over
  // HTTP the authentication work in front of the repo makes interleaving a
  // matter of timing.)
  async function repoFor(cookie: string) {
    const me = (await (await apiRequest(cookie, 'GET', '/api/me')).json()) as { id: string }
    return createFoodRepo(createDb(sqlite), me.id)
  }

  it('two day-count changes at once both apply and leave a whole grid', async () => {
    // Planning the missing slots outside the write let both calls insert
    // day 1, and the second failed the slot unique index.
    const { cookie, listId } = await seedList(0)
    const repo = await repoFor(cookie)
    const results = await Promise.all([repo.setDayCount(listId, 3), repo.setDayCount(listId, 5)])
    expect(results.map((r) => r?.dayCount)).toEqual([3, 5])

    const food = await getFood(cookie, listId)
    expect(food.dayCount).toBe(5)
    expect(food.slots).toHaveLength(15)
    for (let day = 1; day <= 5; day++) {
      expect(food.slots.filter((s) => s.dayNumber === day).map((s) => s.meal).sort()).toEqual([
        'breakfast',
        'dinner',
        'lunch',
      ])
    }
  })

  it('creates at once each get their own sort position and pack rank', async () => {
    // Reading max(sort_order) outside the write gave every create the same
    // position.
    const { cookie, listId } = await seedList(0)
    const repo = await repoFor(cookie)
    const created = await Promise.all(
      ['A', 'B', 'C', 'D', 'E'].map((name) =>
        repo.createItem(listId, { name, weightGrams: 100, quantity: 1, slotIds: [] }),
      ),
    )
    const rows = created.map((result) => {
      if (!result.ok) throw new Error(`create failed: ${result.reason}`)
      return result.row
    })
    expect(rows.map((r) => r.sortOrder)).toEqual([0, 1, 2, 3, 4])
    expect(new Set(rows.map((r) => r.packSortOrder)).size).toBe(5)
  })

  it('a reschedule racing a trim never half-applies', async () => {
    // The reschedule is checked and written before the trim starts, and the
    // trim then cascades the placement it removed. Nothing is refused and
    // nothing is left pointing at a removed slot.
    const { cookie, listId } = await seedList(3)
    const food = await getFood(cookie, listId)
    const day1 = slotId(food, 1, 'breakfast')
    const day3 = slotId(food, 3, 'dinner')
    const item = await addItem(cookie, listId, { name: 'Oats', slotIds: [day1] })
    const repo = await repoFor(cookie)

    const [patch, trim] = await Promise.all([
      repo.updateItem(listId, item.id, { name: 'Renamed', slotIds: [day1, day3] }),
      repo.setDayCount(listId, 2),
    ])
    expect(patch).toMatchObject({ ok: true, row: { name: 'Renamed' } })
    expect(trim?.items.find((i) => i.id === item.id)).toMatchObject({
      name: 'Renamed',
      slotIds: [day1],
    })
  })

  it('an update and a delete of the same item at once: the update lands, then the delete', async () => {
    const { cookie, listId } = await seedList(1)
    const item = await addItem(cookie, listId, { name: 'Oats', slotIds: [] })
    const repo = await repoFor(cookie)
    const [patch, deleted] = await Promise.all([
      repo.updateItem(listId, item.id, { name: 'Renamed' }),
      repo.deleteItem(listId, item.id),
    ])
    expect(patch).toMatchObject({ ok: true, row: { name: 'Renamed' } })
    expect(deleted).toBe(true)
    expect(foodRows(listId).items).toEqual([])
  })
})

describe('food responses are what committed', () => {
  it('the PATCH response matches the stored item', async () => {
    const { cookie, listId } = await seedList(2)
    const food = await getFood(cookie, listId)
    const item = await addItem(cookie, listId, {
      name: 'Oats',
      slotIds: [slotId(food, 1, 'breakfast')],
    })
    // A direct write the request does not know about: the response must
    // report the stored quantity, not one the request assumed.
    sqlite.prepare('update list_food_items set quantity = 7 where id = ?').run(item.id)

    const res = await apiRequest(cookie, 'PATCH', `/api/lists/${listId}/food/items/${item.id}`, {
      name: 'Renamed',
      slotIds: [slotId(food, 2, 'lunch'), slotId(food, 2, 'dinner')],
    })
    expect(res.status).toBe(200)
    const row = (await res.json()) as FoodItemResponse
    expect(row).toMatchObject({ name: 'Renamed', quantity: 7, unitCount: 14 })
    const stored = (await getFood(cookie, listId)).items.find((i) => i.id === item.id)
    expect({ ...row, slotIds: [...row.slotIds].sort() }).toEqual({
      ...stored,
      slotIds: [...stored!.slotIds].sort(),
    })
  })
})

describe('the largest food writes need no parameter chunking', () => {
  it('schedules one item into all 90 slots of a 30-day trip, then reschedules it', async () => {
    // 90 links x 4 columns, and a 90-id membership check, each in ONE
    // statement. The request schemas cap slot ids at 90 (FOOD_SLOT_CAP).
    const { cookie, listId } = await seedList(30)
    const food = await getFood(cookie, listId)
    expect(food.slots).toHaveLength(90)
    const all = food.slots.map((s) => s.id)

    const item = await addItem(cookie, listId, { name: 'Everything', slotIds: all })
    expect(item.slotIds).toEqual(all)
    expect(foodRows(listId).links).toHaveLength(90)

    const reversed = [...all].reverse()
    const res = await apiRequest(cookie, 'PATCH', `/api/lists/${listId}/food/items/${item.id}`, {
      slotIds: reversed,
    })
    expect(res.status).toBe(200)
    expect(((await res.json()) as FoodItemResponse).slotIds.sort()).toEqual([...all].sort())
  })
})
