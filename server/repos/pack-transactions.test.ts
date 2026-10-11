import { env } from '../test/node-env'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiRequest } from '../test/api-helpers'
import { signUpVerifiedUser } from '../test/auth-helpers'

// Packing locations and pack reordering run each operation as ONE SQLite
// transaction (server/repos/packing-locations.ts, pack-reorder.ts). These
// tests prove the "one" part through the real API: a failure injected AFTER
// some of an operation's writes have already run must leave no trace of any
// of them.
//
// The failure is a test-only trigger, created in this file's own database
// and dropped afterwards, that aborts one specific statement in the middle
// of the sequence. Nothing about the transaction or the rollback is mocked.

type Item = { id: string; packingLocationId: string | null; packSortOrder: number }

const sqlite = env.DB
let consoleError: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  // The injected failure is an unclassified error, so the app logs a 500.
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  consoleError.mockRestore()
  sqlite.exec('DROP TRIGGER IF EXISTS test_inject_failure')
})

let users = 0
async function seedBag(itemCount: number) {
  users += 1
  const { cookie } = await signUpVerifiedUser(`pack-tx-${users}@example.com`, 'Tx')
  const list = (await (await apiRequest(cookie, 'POST', '/api/lists', { name: 'Trip' })).json()) as {
    id: string
  }
  const location = (await (
    await apiRequest(cookie, 'POST', `/api/lists/${list.id}/packing-locations`, {
      name: 'Bag',
    })
  ).json()) as { id: string }
  for (let i = 0; i < itemCount; i += 1) {
    const gear = (await (
      await apiRequest(cookie, 'POST', '/api/gear-items', { name: `Gear ${i}` })
    ).json()) as { id: string }
    const item = (await (
      await apiRequest(cookie, 'POST', `/api/lists/${list.id}/items`, { gearItemId: gear.id })
    ).json()) as { id: string }
    const moved = await apiRequest(cookie, 'PATCH', `/api/lists/${list.id}/items/${item.id}`, {
      packingLocationId: location.id,
    })
    expect(moved.status).toBe(200)
  }
  return { cookie, listId: list.id, locationId: location.id }
}

function itemsIn(listId: string): Item[] {
  return sqlite
    .prepare(
      `select id, packing_location_id as packingLocationId, pack_sort_order as packSortOrder
         from list_items where list_id = ? order by id`,
    )
    .all(listId) as Item[]
}

function locationExists(id: string): boolean {
  return sqlite.prepare('select 1 from packing_locations where id = ?').get(id) !== undefined
}

describe('pack reorder is all-or-nothing', () => {
  it('a failure after the first rows moved rolls every row back', async () => {
    const { cookie, listId } = await seedBag(3)
    const before = itemsIn(listId)
    const inBag = [...before].sort((a, b) => a.packSortOrder - b.packSortOrder)
    // Reverse the bag: every row moves.
    const payload = inBag.map((row, i) => ({
      id: row.id,
      packSortOrder: inBag[inBag.length - 1 - i]!.packSortOrder,
    }))
    // Fail the LAST settle: by then every row has parked on a negative
    // scratch rank and all the other rows have settled on their new rank.
    const last = payload[payload.length - 1]!
    sqlite.exec(`
      CREATE TRIGGER test_inject_failure BEFORE UPDATE OF pack_sort_order ON list_items
      WHEN NEW.id = '${last.id}' AND NEW.pack_sort_order >= 0
      BEGIN SELECT RAISE(ABORT, 'test: injected failure'); END
    `)

    const res = await apiRequest(cookie, 'PUT', `/api/lists/${listId}/items/pack-order`, {
      items: payload,
      foodItems: [],
    })
    expect(res.status).toBe(500)
    expect(itemsIn(listId)).toEqual(before)

    // The same request succeeds once the failure is gone, so the rollback
    // above was not a validation refusal.
    sqlite.exec('DROP TRIGGER test_inject_failure')
    const retry = await apiRequest(cookie, 'PUT', `/api/lists/${listId}/items/pack-order`, {
      items: payload,
      foodItems: [],
    })
    expect(retry.status).toBe(204)
    const after = new Map(itemsIn(listId).map((row) => [row.id, row.packSortOrder]))
    for (const move of payload) expect(after.get(move.id)).toBe(move.packSortOrder)
  })

  it('a unique-index failure maps to the route 409 and still rolls back', async () => {
    // The 409 path no longer has a race to report (the transaction holds the
    // write lock), but it stays as the backstop should the index ever
    // disagree with validation. Stage that disagreement with a test-only
    // unique index the validation does not know about: rank 777 may appear
    // once in the whole table, and a row in ANOTHER list already holds it.
    const { cookie, listId } = await seedBag(2)
    const other = await seedBag(0)
    const gear = (await (
      await apiRequest(other.cookie, 'POST', '/api/gear-items', { name: 'Elsewhere' })
    ).json()) as { id: string }
    const added = (await (
      await apiRequest(other.cookie, 'POST', `/api/lists/${other.listId}/items`, {
        gearItemId: gear.id,
      })
    ).json()) as { id: string }
    sqlite.prepare('update list_items set pack_sort_order = 777 where id = ?').run(added.id)
    sqlite.exec(
      'CREATE UNIQUE INDEX test_only_rank ON list_items(pack_sort_order) WHERE pack_sort_order = 777',
    )
    try {
      const before = itemsIn(listId)
      const [a, b] = [...before].sort((x, y) => x.packSortOrder - y.packSortOrder)
      // a settles first onto b's rank, then b's settle onto 777 collides.
      const res = await apiRequest(cookie, 'PUT', `/api/lists/${listId}/items/pack-order`, {
        items: [
          { id: a!.id, packSortOrder: b!.packSortOrder },
          { id: b!.id, packSortOrder: 777 },
        ],
        foodItems: [],
      })
      expect(res.status).toBe(409)
      // a's park and settle, and b's park, were all undone.
      expect(itemsIn(listId)).toEqual(before)
    } finally {
      sqlite.exec('DROP INDEX test_only_rank')
    }
  })

  it('concurrent reorders of the same bag both apply; neither loses a race', async () => {
    // Under D1 the second of two overlapping reorders could answer 409. Each
    // reorder now reads and writes inside one immediate transaction, so they
    // run one after the other and both succeed.
    const { cookie, listId } = await seedBag(3)
    const rows = [...itemsIn(listId)].sort((a, b) => a.packSortOrder - b.packSortOrder)
    const ranks = rows.map((r) => r.packSortOrder)
    const reversed = rows.map((r, i) => ({ id: r.id, packSortOrder: ranks[ranks.length - 1 - i]! }))
    const rotated = rows.map((r, i) => ({ id: r.id, packSortOrder: ranks[(i + 1) % ranks.length]! }))
    const results = await Promise.all(
      [reversed, rotated].map((items) =>
        apiRequest(cookie, 'PUT', `/api/lists/${listId}/items/pack-order`, {
          items,
          foodItems: [],
        }),
      ),
    )
    expect(results.map((r) => r.status)).toEqual([204, 204])
    const final = [...itemsIn(listId)].map((r) => r.packSortOrder).sort((a, b) => a - b)
    expect(final).toEqual([...ranks].sort((a, b) => a - b))
  })
})

describe('deleting a packing location is all-or-nothing', () => {
  it('a failure at the final DELETE rolls back the moves of every item in the bag', async () => {
    const { cookie, listId, locationId } = await seedBag(2)
    const before = itemsIn(listId)
    expect(before.every((row) => row.packingLocationId === locationId)).toBe(true)
    // The DELETE is the last statement; every item has already been moved to
    // Unassigned when it fails.
    sqlite.exec(`
      CREATE TRIGGER test_inject_failure BEFORE DELETE ON packing_locations
      WHEN OLD.id = '${locationId}'
      BEGIN SELECT RAISE(ABORT, 'test: injected failure'); END
    `)

    const res = await apiRequest(
      cookie,
      'DELETE',
      `/api/lists/${listId}/packing-locations/${locationId}`,
    )
    expect(res.status).toBe(500)
    expect(itemsIn(listId)).toEqual(before)
    expect(locationExists(locationId)).toBe(true)

    sqlite.exec('DROP TRIGGER test_inject_failure')
    const retry = await apiRequest(
      cookie,
      'DELETE',
      `/api/lists/${listId}/packing-locations/${locationId}`,
    )
    expect(retry.status).toBe(204)
    expect(locationExists(locationId)).toBe(false)
    expect(itemsIn(listId).every((row) => row.packingLocationId === null)).toBe(true)
  })
})
