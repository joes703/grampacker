import { env } from '../test/node-env'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDb } from '../db'
import { apiRequest } from '../test/api-helpers'
import { signUpVerifiedUser } from '../test/auth-helpers'
import { createCategoriesRepo } from './categories'
import { createGearItemsRepo } from './gear-items'

// Gear items and categories run each read-then-write operation as ONE
// SQLite transaction (server/repos/gear-items.ts, categories.ts), and the
// public share reads in one read transaction (public-shares.ts). These tests
// prove through the real API and repositories that:
//
// - a failure injected AFTER some of an operation's writes have run leaves
//   no trace of any of them;
// - a category deleted while a gear write is in progress lands before or
//   after the whole write, so the old "parent deleted mid-write" 500 is gone,
//   and a foreign-key failure that does happen is a defect (a 500 that
//   writes nothing);
// - unrelated constraint failures are redacted 500s (gear and categories
//   have no retryable conflict, so nothing here answers 409);
// - responses are the stored rows, and refused writes change nothing;
// - a share answers only its allowlist, and missing, private and revoked
//   shares answer identically.
//
// Failures are test-only triggers and indexes, dropped after each test.

const sqlite = env.DB
let consoleError: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  consoleError.mockRestore()
  sqlite.exec('DROP TRIGGER IF EXISTS test_inject_failure')
  sqlite.exec('DROP INDEX IF EXISTS test_only_unique')
})

type GearBody = { id: string; name: string; categoryId: string | null; sortOrder: number }
type CategoryBody = { id: string; name: string; sortOrder: number }

let users = 0
async function newUser() {
  users += 1
  const { cookie } = await signUpVerifiedUser(`gear-tx-${users}@example.com`, 'Tx')
  const me = (await (await apiRequest(cookie, 'GET', '/api/me')).json()) as { id: string }
  return { cookie, userId: me.id }
}

async function send<T>(
  cookie: string,
  method: string,
  path: string,
  body: unknown,
  status: number,
): Promise<T> {
  const res = await apiRequest(cookie, method, path, body)
  expect(res.status, `${method} ${path}`).toBe(status)
  return (await res.json()) as T
}

const createCategory = (cookie: string, name: string) =>
  send<CategoryBody>(cookie, 'POST', '/api/categories', { name }, 201)
const createGear = (cookie: string, name: string, categoryId: string | null = null) =>
  send<GearBody>(cookie, 'POST', '/api/gear-items', { name, weightGrams: 100, categoryId }, 201)

async function listGear(cookie: string): Promise<GearBody[]> {
  const res = await apiRequest(cookie, 'GET', '/api/gear-items')
  expect(res.status).toBe(200)
  return (await res.json()) as GearBody[]
}

async function listCategories(cookie: string): Promise<CategoryBody[]> {
  const res = await apiRequest(cookie, 'GET', '/api/categories')
  expect(res.status).toBe(200)
  return (await res.json()) as CategoryBody[]
}

// Every row one user owns, read directly, in a stable order.
const OWNED_TABLES = ['categories', 'gear_items', 'lists', 'list_items', 'packing_locations'] as const
function snapshot(userId: string) {
  return Object.fromEntries(
    OWNED_TABLES.map((table) => [
      table,
      sqlite.prepare(`select * from ${table} where user_id = ? order by rowid`).all(userId),
    ]),
  )
}

const repos = (userId: string) => {
  const db = createDb(sqlite)
  return { gear: createGearItemsRepo(db, userId), categories: createCategoriesRepo(db, userId) }
}

describe('every multi-write gear and category operation is all-or-nothing', () => {
  it('gear import: a failure at the last item rolls back the new categories and items', async () => {
    const { cookie, userId } = await newUser()
    const existing = await createCategory(cookie, 'Existing')
    const before = snapshot(userId)
    injectFailureOnGearName('Last')
    const body = {
      categories: [{ tempId: 'c1', name: 'New' }],
      items: [
        { name: 'First', weightGrams: 1, category: { kind: 'new', tempId: 'c1' } },
        { name: 'Middle', weightGrams: 1, category: { kind: 'existing', id: existing.id } },
        { name: 'Last', weightGrams: 1, category: null },
      ],
    }

    expect((await apiRequest(cookie, 'POST', '/api/gear-items/import', body)).status).toBe(500)
    expect(snapshot(userId)).toEqual(before)

    sqlite.exec('DROP TRIGGER test_inject_failure')
    expect((await apiRequest(cookie, 'POST', '/api/gear-items/import', body)).status).toBe(201)
  })

  it('category delete: a failure at the delete puts the gear back in the category', async () => {
    const { cookie, userId } = await newUser()
    const category = await createCategory(cookie, 'Shelter')
    await createGear(cookie, 'Tent', category.id)
    await createGear(cookie, 'Tarp', category.id)
    const before = snapshot(userId)
    // The gear is uncategorized first, then the category deleted.
    sqlite.exec(`
      CREATE TRIGGER test_inject_failure BEFORE DELETE ON categories
      WHEN OLD.id = '${category.id}'
      BEGIN SELECT RAISE(ABORT, 'test: injected failure'); END
    `)

    expect((await apiRequest(cookie, 'DELETE', `/api/categories/${category.id}`)).status).toBe(500)
    expect(snapshot(userId)).toEqual(before)
  })

  for (const [what, table, path] of [
    ['gear reorder', 'gear_items', '/api/gear-items/order'],
    ['category reorder', 'categories', '/api/categories/order'],
  ] as const) {
    it(`${what}: a failure at the last row restores every position`, async () => {
      const { cookie, userId } = await newUser()
      const make = table === 'gear_items' ? createGear : createCategory
      const rows = [await make(cookie, 'A'), await make(cookie, 'B'), await make(cookie, 'C')]
      const before = snapshot(userId)
      sqlite.exec(`
        CREATE TRIGGER test_inject_failure BEFORE UPDATE OF sort_order ON ${table}
        WHEN NEW.id = '${rows[2]!.id}'
        BEGIN SELECT RAISE(ABORT, 'test: injected failure'); END
      `)

      const order = rows.map((row, i) => ({ id: row.id, sortOrder: 10 - i }))
      expect((await apiRequest(cookie, 'PUT', path, order)).status).toBe(500)
      expect(snapshot(userId)).toEqual(before)
    })
  }

  it('bulk delete: a failure in the list-item cascade keeps every gear row and membership', async () => {
    // One DELETE statement takes the gear and, by cascade, its list
    // memberships; SQLite undoes a failed statement whole even without the
    // transaction. Pinned because it is the bulk write with dependents.
    const { cookie, userId } = await newUser()
    const gear = [await createGear(cookie, 'A'), await createGear(cookie, 'B')]
    const list = await send<{ id: string }>(cookie, 'POST', '/api/lists', { name: 'Trip' }, 201)
    for (const g of gear) {
      await send(cookie, 'POST', `/api/lists/${list.id}/items`, { gearItemId: g.id }, 201)
    }
    const before = snapshot(userId)
    sqlite.exec(`
      CREATE TRIGGER test_inject_failure BEFORE DELETE ON list_items
      WHEN OLD.gear_item_id = '${gear[1]!.id}'
      BEGIN SELECT RAISE(ABORT, 'test: injected failure'); END
    `)

    const res = await apiRequest(cookie, 'POST', '/api/gear-items/bulk-delete', {
      ids: gear.map((g) => g.id),
    })
    expect(res.status).toBe(500)
    expect(snapshot(userId)).toEqual(before)
  })
})

function injectFailureOnGearName(name: string) {
  sqlite.exec(`
    CREATE TRIGGER test_inject_failure BEFORE INSERT ON gear_items
    WHEN NEW.name = '${name}'
    BEGIN SELECT RAISE(ABORT, 'test: injected failure'); END
  `)
}

describe('a category deleted during a gear write', () => {
  // Each test starts a gear operation, then - in the same tick - deletes the
  // category it names, through the real categories repository. A gear
  // operation whose check and write are one synchronous transaction has
  // already committed by then, so the delete runs after it and
  // uncategorizes the gear. Code that awaited between its category check
  // and its write let the delete in between, and the write failed its
  // foreign key with a 500.
  async function setup() {
    const { cookie, userId } = await newUser()
    const category = await createCategory(cookie, 'Doomed')
    return { cookie, userId, category, r: repos(userId) }
  }

  it('create lands whole, then the delete uncategorizes it', async () => {
    const { cookie, category, r } = await setup()
    const [created, deleted] = await Promise.all([
      r.gear.create({
        name: 'Tent',
        description: null,
        weightGrams: 900,
        categoryId: category.id,
        costCents: null,
        purchaseDate: null,
        status: 'active',
      }),
      r.categories.remove(category.id),
    ])
    expect(created).toMatchObject({ ok: true, row: { categoryId: category.id } })
    expect(deleted).toBe(true)
    expect((await listGear(cookie)).map((g) => g.categoryId)).toEqual([null])
  })

  it('update lands whole, then the delete uncategorizes it', async () => {
    const { cookie, category, r } = await setup()
    const gear = await createGear(cookie, 'Tent')
    const [updated] = await Promise.all([
      r.gear.update(gear.id, { categoryId: category.id, name: 'Renamed' }),
      r.categories.remove(category.id),
    ])
    expect(updated).toMatchObject({ ok: true, row: { categoryId: category.id } })
    expect(await listGear(cookie)).toMatchObject([{ name: 'Renamed', categoryId: null }])
  })

  it('bulk move lands whole, then the delete uncategorizes every moved row', async () => {
    const { cookie, category, r } = await setup()
    const gear = [await createGear(cookie, 'A'), await createGear(cookie, 'B')]
    const [moved] = await Promise.all([
      r.gear.bulkMove(gear.map((g) => g.id), category.id),
      r.categories.remove(category.id),
    ])
    expect(moved).toBe('ok')
    expect((await listGear(cookie)).map((g) => g.categoryId)).toEqual([null, null])
  })

  it('import lands whole, then the delete uncategorizes its rows', async () => {
    const { cookie, category, r } = await setup()
    const [imported] = await Promise.all([
      r.gear.importBatch({
        categories: [],
        items: [
          {
            name: 'Imported',
            description: null,
            weightGrams: 1,
            costCents: null,
            purchaseDate: null,
            category: { kind: 'existing', id: category.id },
          },
        ],
      }),
      r.categories.remove(category.id),
    ])
    expect(imported).toEqual({ ok: true, createdCategories: 0, createdItems: 1 })
    expect(await listGear(cookie)).toMatchObject([{ name: 'Imported', categoryId: null }])
  })

  it('a foreign-key failure inside the write is a 500 and undoes everything', async () => {
    // Inside the transaction the category cannot disappear between the
    // check and the insert, so a foreign-key failure can only be a defect.
    // Stage one: a trigger deletes the category just before the gear row
    // that names it is inserted. The repo must not explain it away as a
    // client error, and the trigger's own delete must roll back too.
    const { cookie, userId, category } = await setup()
    const before = snapshot(userId)
    sqlite.exec(`
      CREATE TRIGGER test_inject_failure BEFORE INSERT ON gear_items
      WHEN NEW.category_id = '${category.id}'
      BEGIN DELETE FROM categories WHERE id = '${category.id}'; END
    `)

    const res = await apiRequest(cookie, 'POST', '/api/gear-items', {
      name: 'Tent',
      weightGrams: 900,
      categoryId: category.id,
    })
    expect(res.status).toBe(500)
    expect(snapshot(userId)).toEqual(before)
  })
})

describe('overlapping gear operations', () => {
  it('a reorder and a bulk delete at once: the reorder lands, then the delete', async () => {
    const { cookie, userId } = await newUser()
    const gear = [await createGear(cookie, 'A'), await createGear(cookie, 'B'), await createGear(cookie, 'C')]
    const r = repos(userId)
    const [reordered, deleted] = await Promise.all([
      r.gear.reorder(gear.map((g, i) => ({ id: g.id, sortOrder: 10 - i }))),
      r.gear.bulkDelete([gear[0]!.id]),
    ])
    expect([reordered, deleted]).toEqual([true, true])
    expect((await listGear(cookie)).map((g) => [g.name, g.sortOrder])).toEqual([
      ['C', 8],
      ['B', 9],
    ])
  })

  it('five creates at once each take their own position', async () => {
    const { userId } = await newUser()
    const r = repos(userId)
    const results = await Promise.all(
      ['A', 'B', 'C', 'D', 'E'].map((name) =>
        r.gear.create({
          name,
          description: null,
          weightGrams: 1,
          categoryId: null,
          costCents: null,
          purchaseDate: null,
          status: 'active',
        }),
      ),
    )
    expect(results.map((result) => (result.ok ? result.row.sortOrder : -1))).toEqual([0, 1, 2, 3, 4])
  })
})

describe('gear and category error classification', () => {
  it('an unrelated unique failure is a redacted 500 on every gear write, with nothing written', async () => {
    // A unique index on a column nothing expects to be unique: the name
    // 'Only once' may appear once in the whole table, and another user's
    // gear holds it. No gear route has a retryable conflict.
    const other = await newUser()
    await createGear(other.cookie, 'Only once')
    sqlite.exec(`CREATE UNIQUE INDEX test_only_unique ON gear_items(name) WHERE name = 'Only once'`)
    const { cookie, userId } = await newUser()
    const mine = await createGear(cookie, 'Mine')
    const before = snapshot(userId)

    for (const [method, path, body] of [
      ['POST', '/api/gear-items', { name: 'Only once', weightGrams: 1 }],
      ['PATCH', `/api/gear-items/${mine.id}`, { name: 'Only once' }],
      [
        'POST',
        '/api/gear-items/import',
        {
          categories: [{ tempId: 'c1', name: 'New' }],
          items: [
            { name: 'Fine', weightGrams: 1, category: { kind: 'new', tempId: 'c1' } },
            { name: 'Only once', weightGrams: 1, category: null },
          ],
        },
      ],
    ] as const) {
      const res = await apiRequest(cookie, method, path, body)
      expect(res.status, `${method} ${path}`).toBe(500)
      const text = await res.text()
      expect(text).not.toContain('UNIQUE')
      expect(text).not.toContain('Only once')
    }
    expect(snapshot(userId)).toEqual(before)
  })

  it('the caps stay 422s', async () => {
    // Pinned at the full size in gear-items.test.ts and categories.test.ts;
    // here, the mapping survives the move into transactions.
    const { cookie, userId } = await newUser()
    sqlite.exec(`
      CREATE TRIGGER test_inject_failure BEFORE INSERT ON gear_items
      BEGIN SELECT RAISE(ABORT, 'gear item cap exceeded (500 per user)'); END
    `)
    const before = snapshot(userId)
    const res = await apiRequest(cookie, 'POST', '/api/gear-items', { name: 'X', weightGrams: 1 })
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ error: 'Gear item limit reached (500 per user)' })
    expect(snapshot(userId)).toEqual(before)
  })
})

describe('gear and category responses are what committed', () => {
  it('create, update and category rename answer with the stored row', async () => {
    const { cookie } = await newUser()
    const category = await createCategory(cookie, 'Shelter')
    const created = await createGear(cookie, 'Tent', category.id)
    const updated = await send<GearBody>(cookie, 'PATCH', `/api/gear-items/${created.id}`, {
      name: 'Big tent',
      weightGrams: 1200,
      categoryId: null,
    }, 200)
    const renamed = await send<CategoryBody>(cookie, 'PATCH', `/api/categories/${category.id}`, {
      name: 'Sleep',
    }, 200)
    expect((await listGear(cookie)).find((g) => g.id === created.id)).toEqual(updated)
    expect((await listCategories(cookie)).find((c) => c.id === category.id)).toEqual(renamed)
  })
})

describe('refused gear and category writes change nothing', () => {
  it('another user and an anonymous caller: every write is refused and no row moves', async () => {
    const owner = await newUser()
    const category = await createCategory(owner.cookie, 'Mine')
    const gear = await createGear(owner.cookie, 'Mine', category.id)
    const intruder = await newUser()
    const theirs = await createGear(intruder.cookie, 'Theirs')
    const before = { owner: snapshot(owner.userId), intruder: snapshot(intruder.userId) }

    const writes = [
      ['PATCH', `/api/gear-items/${gear.id}`, { name: 'Stolen' }, 404],
      ['DELETE', `/api/gear-items/${gear.id}`, undefined, 404],
      ['POST', '/api/gear-items/bulk-delete', { ids: [theirs.id, gear.id] }, 404],
      ['POST', '/api/gear-items/bulk-move', { ids: [theirs.id, gear.id], categoryId: null }, 404],
      ['PUT', '/api/gear-items/order', [{ id: gear.id, sortOrder: 9 }], 404],
      // The intruder's own gear, the owner's category.
      ['POST', '/api/gear-items', { name: 'X', weightGrams: 1, categoryId: category.id }, 400],
      ['PATCH', `/api/gear-items/${theirs.id}`, { categoryId: category.id }, 400],
      ['POST', '/api/gear-items/bulk-move', { ids: [theirs.id], categoryId: category.id }, 400],
      [
        'POST',
        '/api/gear-items/import',
        { categories: [], items: [{ name: 'X', weightGrams: 1, category: { kind: 'existing', id: category.id } }] },
        400,
      ],
      ['PATCH', `/api/categories/${category.id}`, { name: 'Stolen' }, 404],
      ['DELETE', `/api/categories/${category.id}`, undefined, 404],
      ['PUT', '/api/categories/order', [{ id: category.id, sortOrder: 9 }], 404],
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

describe('public shares', () => {
  // Every key a share response may carry, at every level. Anything else -
  // including every private field set to a non-default value below - fails.
  const ALLOWED = {
    top: ['categories', 'food', 'items', 'list'],
    list: ['description', 'isDraft', 'name'],
    category: ['id', 'name', 'sortOrder'],
    item: ['gear', 'gearItemId', 'id', 'isConsumable', 'isWorn', 'quantity', 'sortOrder'],
    gear: ['categoryId', 'description', 'name', 'weightGrams'],
    food: ['items'],
    foodItem: ['id', 'name', 'sortOrder', 'unitCount', 'weightGrams'],
  }
  const keys = (value: unknown) => Object.keys(value as object).sort()

  it('answers only the allowlist, with every private field populated', async () => {
    const { cookie } = await newUser()
    const category = await createCategory(cookie, 'Shelter')
    const gear = await send<GearBody>(cookie, 'POST', '/api/gear-items', {
      name: 'Tent',
      weightGrams: 900,
      categoryId: category.id,
      cost: 199.5,
      purchaseDate: '2026-01-02',
      status: 'needs_repair',
    }, 201)
    const list = await send<{ id: string; slug: string }>(cookie, 'POST', '/api/lists', { name: 'Trip' }, 201)
    const bag = await send<{ id: string }>(cookie, 'POST', `/api/lists/${list.id}/packing-locations`, { name: 'Bag' }, 201)
    const item = await send<{ id: string }>(cookie, 'POST', `/api/lists/${list.id}/items`, { gearItemId: gear.id }, 201)
    await send(cookie, 'PATCH', `/api/lists/${list.id}/items/${item.id}`, {
      isPacked: true,
      isReady: true,
      packingLocationId: bag.id,
    }, 200)
    const days = await send<{ slots: { id: string }[] }>(cookie, 'PUT', `/api/lists/${list.id}/food/days`, { days: 1 }, 200)
    const food = await send<{ id: string }>(cookie, 'POST', `/api/lists/${list.id}/food/items`, {
      name: 'Oats',
      weightGrams: 90,
      quantity: 2,
      slotIds: [days.slots[0]!.id],
    }, 201)
    await send(cookie, 'PATCH', `/api/lists/${list.id}/food/items/${food.id}`, {
      isPacked: true,
      packingLocationId: bag.id,
    }, 200)
    await send(cookie, 'PATCH', `/api/lists/${list.id}`, { isShared: true }, 200)

    const res = await apiRequest(null, 'GET', `/api/shares/v2/${list.slug}`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      list: unknown
      categories: unknown[]
      items: { gear: unknown }[]
      food: { items: unknown[] }
    }
    expect(keys(body)).toEqual(ALLOWED.top)
    expect(keys(body.list)).toEqual(ALLOWED.list)
    expect(body.categories.map(keys)).toEqual([ALLOWED.category])
    expect(body.items.map(keys)).toEqual([ALLOWED.item])
    expect(body.items.map((i) => keys(i.gear))).toEqual([ALLOWED.gear])
    expect(keys(body.food)).toEqual(ALLOWED.food)
    expect(body.food.items.map(keys)).toEqual([ALLOWED.foodItem])
  })

  it('a missing, a private and a revoked share answer the same 404, never stored', async () => {
    const { cookie } = await newUser()
    const shared = await send<{ id: string; slug: string }>(cookie, 'POST', '/api/lists', { name: 'Shared' }, 201)
    await send(cookie, 'PATCH', `/api/lists/${shared.id}`, { isShared: true }, 200)
    const revokedSlug = shared.slug
    const rotated = await send<{ slug: string }>(cookie, 'POST', `/api/lists/${shared.id}/share-link`, undefined, 200)
    const priv = await send<{ slug: string }>(cookie, 'POST', '/api/lists', { name: 'Private' }, 201)

    const answers = []
    for (const slug of ['nosuch', priv.slug, revokedSlug]) {
      const res = await apiRequest(null, 'GET', `/api/shares/v2/${slug}`)
      answers.push({
        status: res.status,
        cache: res.headers.get('cache-control'),
        body: await res.text(),
      })
    }
    expect(answers).toEqual(
      Array(3).fill({ status: 404, cache: 'private, no-store', body: '{"error":"Not found"}' }),
    )
    // The rotated link still serves the shared list.
    expect((await apiRequest(null, 'GET', `/api/shares/v2/${rotated.slug}`)).status).toBe(200)
  })
})
