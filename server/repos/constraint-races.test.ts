import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { createDb, type Db } from '../db'
import { createFoodRepo } from './food'
import { createListItemsRepo } from './list-items'
import { createListsRepo } from './lists'
import { listItemFailure } from '../routes/lists'
import { apiRequest } from '../test/api-helpers'
import { signUpVerifiedUser } from '../test/auth-helpers'

// The precheck-race catches (review P2.5 + P2.9). Every site here prechecks
// its parents, then writes - and a concurrent delete can land in between. The
// window cannot be staged through the HTTP surface (requests serialize), so
// these tests wrap the repo's OWN db handle and sabotage the parent at the
// last instant before the write executes. The write then fails with the REAL
// D1 foreign-key error, and the recovery path re-probes real database state -
// nothing about the error or the probes is simulated.

const raw = () => createDb(env.DB)

async function newUser(tag: string) {
  const email = `race-${tag}@example.com`
  const { cookie } = await signUpVerifiedUser(email, `R-${tag}`)
  const row = await env.DB.prepare('select id from user where email = ?')
    .bind(email)
    .first<{ id: string }>()
  if (!row) throw new Error(`no user row for ${email}`)
  return { cookie, userId: row.id }
}

async function createList(cookie: string, name: string): Promise<string> {
  const res = await apiRequest(cookie, 'POST', '/api/lists', { name })
  if (res.status !== 201) throw new Error(`create list: ${res.status}`)
  return ((await res.json()) as { id: string }).id
}

async function createGear(cookie: string, name: string): Promise<string> {
  const res = await apiRequest(cookie, 'POST', '/api/gear-items', {
    name,
    weightGrams: 100,
  })
  if (res.status !== 201) throw new Error(`create gear: ${res.status}`)
  return ((await res.json()) as { id: string }).id
}

async function createCategory(cookie: string, name: string): Promise<string> {
  const res = await apiRequest(cookie, 'POST', '/api/categories', { name })
  if (res.status !== 201) throw new Error(`create category: ${res.status}`)
  return ((await res.json()) as { id: string }).id
}

async function slotIdsFor(cookie: string, listId: string, days: number) {
  const res = await apiRequest(cookie, 'PUT', `/api/lists/${listId}/food/days`, {
    days,
  })
  if (res.status !== 200) throw new Error(`set days: ${res.status}`)
  const food = (await res.json()) as { slots: { id: string }[] }
  return food.slots.map((s) => s.id)
}

// Wraps a db handle so the (skip+1)th operation executed through `method`
// runs `sabotage` immediately before it. `skip` exists because some
// PRECHECKS also batch (usableSlotIds), and the point is to corrupt the
// world after every precheck has honestly passed - the race window under
// test. Everything else - including the recovery probes the repo runs
// afterwards - passes straight through to the real handle, so recovery sees
// exactly the state the sabotage left.
function sabotaged(
  db: Db,
  method: 'batch' | 'insert' | 'update',
  sabotage: () => Promise<void>,
  skip = 0,
): Db {
  let calls = 0
  let fired = false
  const pre = async () => {
    if (fired || calls++ < skip) return
    fired = true
    await sabotage()
  }
  if (method === 'batch') {
    return new Proxy(db, {
      get(target, prop, receiver) {
        if (prop === 'batch') {
          return async (stmts: Parameters<Db['batch']>[0]) => {
            await pre()
            return target.batch(stmts)
          }
        }
        return Reflect.get(target, prop, receiver)
      },
    }) as Db
  }
  // insert/update return a builder chain; the query only executes when the
  // final builder is awaited. Wrap every link of the chain and run the
  // sabotage when `then` is finally pulled.
  const wrapChain = (builder: object): unknown =>
    new Proxy(builder, {
      get(target, prop) {
        if (prop === 'then') {
          // Boxed so the promise chain does not ADOPT the thenable builder
          // (which would execute the query before the sabotage ran).
          return (
            onFulfilled: (v: unknown) => unknown,
            onRejected: (e: unknown) => unknown,
          ) =>
            pre()
              .then(() => ({ builder: target as PromiseLike<unknown> }))
              .then(({ builder }) => builder.then(onFulfilled, onRejected))
        }
        const value = Reflect.get(target, prop) as unknown
        if (typeof value === 'function') {
          return (...args: unknown[]) =>
            wrapChain(
              (value as (...a: unknown[]) => object).apply(target, args),
            )
        }
        return value
      },
    })
  return new Proxy(db, {
    get(target, prop, receiver) {
      if (prop === method) {
        const original = Reflect.get(target, prop, receiver) as (
          ...a: unknown[]
        ) => object
        return (...args: unknown[]) => wrapChain(original.apply(target, args))
      }
      return Reflect.get(target, prop, receiver)
    },
  }) as Db
}

// A builder chain whose execution rejects with `err` - for the branches whose
// triggering state cannot exist in a serialized database (update()'s rank
// collision) and for proving unexplained errors rethrow. The error SHAPE is
// the real one: DrizzleQueryError-style wrapper with the raw SQLite message
// at the root cause, which is where the matchers look. `skip` passes the
// first N calls through untouched (prechecks that share the method), and
// every call AFTER the failing one passes through too, so recovery probes
// run for real.
function failing(
  db: Db,
  method: 'batch' | 'insert' | 'update',
  err: Error,
  skip = 0,
): Db {
  let calls = 0
  const shouldFail = () => calls++ === skip
  return new Proxy(db, {
    get(target, prop, receiver) {
      if (prop === method) {
        if (method === 'batch') {
          return (stmts: Parameters<Db['batch']>[0]) =>
            shouldFail() ? Promise.reject(err) : target.batch(stmts)
        }
        const original = Reflect.get(target, prop, receiver) as (
          ...a: unknown[]
        ) => unknown
        const reject = (): unknown =>
          new Proxy(() => {}, {
            get(_t, p) {
              if (p === 'then') {
                return (
                  onFulfilled: (v: unknown) => unknown,
                  onRejected: (e: unknown) => unknown,
                ) => Promise.reject(err).then(onFulfilled, onRejected)
              }
              return reject
            },
            apply: () => reject(),
          })
        return (...args: unknown[]) =>
          shouldFail() ? reject() : original.apply(target, args)
      }
      return Reflect.get(target, prop, receiver)
    },
  }) as Db
}

const fkViolation = () =>
  new Error('D1_ERROR', {
    cause: new Error(
      'FOREIGN KEY constraint failed: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_FOREIGNKEY)',
    ),
  })

const rankCollision = () =>
  new Error('D1_ERROR', {
    cause: new Error(
      'UNIQUE constraint failed: list_items.list_id, list_items.packing_location_id, list_items.pack_sort_order: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_UNIQUE)',
    ),
  })

describe('food createItem loses a race', () => {
  it('slot trimmed after the precheck -> invalid_slots, not a 500', async () => {
    const { cookie, userId } = await newUser('f1')
    const listId = await createList(cookie, 'Trip')
    const [slotId] = await slotIdsFor(cookie, listId, 2)
    if (!slotId) throw new Error('no slots')

    const repo = createFoodRepo(
      // skip 1: usableSlotIds itself batches, and the point is to trim the
      // slot AFTER that precheck has honestly passed.
      sabotaged(raw(), 'batch', async () => {
        await env.DB.prepare('delete from list_food_slots where id = ?')
          .bind(slotId)
          .run()
      }, 1),
      userId,
    )
    const result = await repo.createItem(listId, {
      name: 'Couscous',
      weightGrams: 120,
      quantity: 1,
      slotIds: [slotId],
    })
    expect(result).toEqual({ ok: false, reason: 'invalid_slots' })
  })

  it('the whole list deleted after the precheck -> not_found', async () => {
    const { cookie, userId } = await newUser('f2')
    const listId = await createList(cookie, 'Trip')
    const [slotId] = await slotIdsFor(cookie, listId, 2)
    if (!slotId) throw new Error('no slots')

    const repo = createFoodRepo(
      sabotaged(raw(), 'batch', async () => {
        await env.DB.prepare('delete from lists where id = ?').bind(listId).run()
      }, 1),
      userId,
    )
    const result = await repo.createItem(listId, {
      name: 'Couscous',
      weightGrams: 120,
      quantity: 1,
      slotIds: [slotId],
    })
    // List-first precedence: the cascade also took the slots, and the honest
    // answer is the list is gone, not that the slots were invalid.
    expect(result).toEqual({ ok: false, reason: 'not_found' })
  })
})

describe('food updateItem loses a race', () => {
  async function seedItem(cookie: string, listId: string, slotId: string) {
    const res = await apiRequest(cookie, 'POST', `/api/lists/${listId}/food/items`, {
      name: 'Oats',
      weightGrams: 90,
      quantity: 1,
      slotIds: [slotId],
    })
    if (res.status !== 201) throw new Error(`create food item: ${res.status}`)
    return ((await res.json()) as { id: string }).id
  }

  it('item deleted after the precheck -> not_found', async () => {
    const { cookie, userId } = await newUser('f3')
    const listId = await createList(cookie, 'Trip')
    const [slotId, otherSlot] = await slotIdsFor(cookie, listId, 2)
    if (!slotId || !otherSlot) throw new Error('no slots')
    const itemId = await seedItem(cookie, listId, slotId)

    const repo = createFoodRepo(
      sabotaged(raw(), 'batch', async () => {
        await env.DB.prepare('delete from list_food_items where id = ?')
          .bind(itemId)
          .run()
      }, 1),
      userId,
    )
    const result = await repo.updateItem(listId, itemId, { slotIds: [otherSlot] })
    expect(result).toEqual({ ok: false, reason: 'not_found' })
  })

  it('item AND a slot both gone -> not_found wins (probe precedence)', async () => {
    const { cookie, userId } = await newUser('f4')
    const listId = await createList(cookie, 'Trip')
    const [slotId, otherSlot] = await slotIdsFor(cookie, listId, 2)
    if (!slotId || !otherSlot) throw new Error('no slots')
    const itemId = await seedItem(cookie, listId, slotId)

    const repo = createFoodRepo(
      sabotaged(raw(), 'batch', async () => {
        await env.DB.prepare('delete from list_food_items where id = ?')
          .bind(itemId)
          .run()
        await env.DB.prepare('delete from list_food_slots where id = ?')
          .bind(otherSlot)
          .run()
      }, 1),
      userId,
    )
    const result = await repo.updateItem(listId, itemId, { slotIds: [otherSlot] })
    expect(result).toEqual({ ok: false, reason: 'not_found' })
  })

  it('slot trimmed while rescheduling -> invalid_slots', async () => {
    const { cookie, userId } = await newUser('f5')
    const listId = await createList(cookie, 'Trip')
    const [slotId, otherSlot] = await slotIdsFor(cookie, listId, 2)
    if (!slotId || !otherSlot) throw new Error('no slots')
    const itemId = await seedItem(cookie, listId, slotId)

    const repo = createFoodRepo(
      sabotaged(raw(), 'batch', async () => {
        await env.DB.prepare('delete from list_food_slots where id = ?')
          .bind(otherSlot)
          .run()
      }, 1),
      userId,
    )
    const result = await repo.updateItem(listId, itemId, { slotIds: [otherSlot] })
    expect(result).toEqual({ ok: false, reason: 'invalid_slots' })
  })

  it('an FK nothing explains rethrows instead of blaming the client', async () => {
    const { cookie, userId } = await newUser('f6')
    const listId = await createList(cookie, 'Trip')
    const [slotId] = await slotIdsFor(cookie, listId, 2)
    if (!slotId) throw new Error('no slots')
    const itemId = await seedItem(cookie, listId, slotId)

    // The batch reports an FK violation but every parent still exists: the
    // recovery probes all pass, so the repo must NOT invent a reason.
    // skip 1: usableSlotIds' real batch passes, the WRITE batch reports the
    // FK, and the recovery probes then run against the real (intact) rows.
    const repo = createFoodRepo(failing(raw(), 'batch', fkViolation(), 1), userId)
    await expect(
      repo.updateItem(listId, itemId, { slotIds: [slotId] }),
    ).rejects.toThrow('D1_ERROR')
  })
})

describe('addExisting loses a race', () => {
  it('gear deleted after the precheck -> invalid_gear', async () => {
    const { cookie, userId } = await newUser('li1')
    const listId = await createList(cookie, 'Trip')
    const gearId = await createGear(cookie, 'Stove')

    const repo = createListItemsRepo(
      sabotaged(raw(), 'insert', async () => {
        await env.DB.prepare('delete from gear_items where id = ?')
          .bind(gearId)
          .run()
      }),
      userId,
    )
    const result = await repo.addExisting(listId, gearId)
    expect(result).toEqual({ ok: false, reason: 'invalid_gear' })
  })

  it('list deleted after the precheck -> list_not_found', async () => {
    const { cookie, userId } = await newUser('li2')
    const listId = await createList(cookie, 'Trip')
    const gearId = await createGear(cookie, 'Stove')

    const repo = createListItemsRepo(
      sabotaged(raw(), 'insert', async () => {
        await env.DB.prepare('delete from lists where id = ?').bind(listId).run()
      }),
      userId,
    )
    const result = await repo.addExisting(listId, gearId)
    expect(result).toEqual({ ok: false, reason: 'list_not_found' })
  })
})

describe('list CSV import loses a race', () => {
  const importInput = (gearId: string | null, categoryId: string | null) => ({
    name: 'Imported',
    categories: [],
    gear:
      categoryId === null
        ? []
        : [
            {
              tempId: 'g1',
              category: { kind: 'existing' as const, id: categoryId },
              name: 'New tent',
              description: null,
              weightGrams: 900,
              costCents: null,
            },
          ],
    items:
      gearId === null
        ? [
            {
              gear: { kind: 'new' as const, tempId: 'g1' },
              quantity: 1,
              isWorn: false,
              isConsumable: false,
              sortOrder: 0,
            },
          ]
        : [
            {
              gear: { kind: 'existing' as const, id: gearId },
              quantity: 1,
              isWorn: false,
              isConsumable: false,
              sortOrder: 0,
            },
          ],
  })

  it('referenced gear deleted after the precheck -> invalid_gear', async () => {
    const { cookie, userId } = await newUser('im1')
    const gearId = await createGear(cookie, 'Old tarp')

    const repo = createListsRepo(
      sabotaged(raw(), 'batch', async () => {
        await env.DB.prepare('delete from gear_items where id = ?')
          .bind(gearId)
          .run()
      }),
      userId,
    )
    const result = await repo.importFromCsv(importInput(gearId, null))
    expect(result).toEqual({ ok: false, reason: 'invalid_gear' })
  })

  it('referenced category deleted after the precheck -> invalid_category', async () => {
    const { cookie, userId } = await newUser('im2')
    const categoryId = await createCategory(cookie, 'Shelter')

    const repo = createListsRepo(
      sabotaged(raw(), 'batch', async () => {
        await env.DB.prepare('delete from categories where id = ?')
          .bind(categoryId)
          .run()
      }),
      userId,
    )
    const result = await repo.importFromCsv(importInput(null, categoryId))
    expect(result).toEqual({ ok: false, reason: 'invalid_category' })
  })
})

describe('update() rank collision', () => {
  // The colliding state cannot exist in a serialized database - the rank is
  // computed by a subquery inside the UPDATE - so the branch is exercised by
  // failing the write with the real error SHAPE. What matters is the mapping:
  // a unique violation from this statement is a lost race, never a 500.
  it('maps the unique violation to conflict', async () => {
    const { cookie, userId } = await newUser('u1')
    const listId = await createList(cookie, 'Trip')
    const gearId = await createGear(cookie, 'Stove')
    const add = await apiRequest(cookie, 'POST', `/api/lists/${listId}/items`, {
      gearItemId: gearId,
    })
    if (add.status !== 201) throw new Error(`add item: ${add.status}`)
    const itemId = ((await add.json()) as { id: string }).id

    const repo = createListItemsRepo(
      failing(raw(), 'update', rankCollision()),
      userId,
    )
    const result = await repo.update(listId, itemId, {
      packingLocationId: null,
    })
    expect(result).toEqual({ ok: false, reason: 'conflict' })
  })
})

describe('listItemFailure', () => {
  it('maps conflict to a 409 in the pack-order dialect', () => {
    expect(listItemFailure({ ok: false, reason: 'conflict' })).toEqual({
      status: 409,
      error: 'This bag changed while you were moving that item',
    })
  })

  it('keeps the existing mappings stable', () => {
    expect(listItemFailure({ ok: false, reason: 'not_found' }).status).toBe(404)
    expect(listItemFailure({ ok: false, reason: 'invalid_gear' }).status).toBe(400)
    expect(listItemFailure({ ok: false, reason: 'cap_exceeded' }).status).toBe(422)
  })
})

// The server half of the pack-order 409 (review P2.2: "409 both sides" had
// only client handling and a route branch nothing drove). Two real error
// shapes convert to `conflict` inside production reorderPack() - a rank
// collision on the unique index and the park guard's NOT NULL - and neither
// can be staged through HTTP: the payload must be a permutation of the
// cohort's CURRENT ranks, so any state that would collide is rejected as a
// 400 before the batch. Hence the failing-db harness, same as update().
describe('reorderPack loses a race', () => {
  async function seedTwoItemCohort(cookie: string, listId: string) {
    const gearA = await createGear(cookie, 'Stove A')
    const gearB = await createGear(cookie, 'Stove B')
    for (const gearItemId of [gearA, gearB]) {
      const res = await apiRequest(cookie, 'POST', `/api/lists/${listId}/items`, {
        gearItemId,
      })
      if (res.status !== 201) throw new Error(`add item: ${res.status}`)
    }
    const items = await apiRequest(cookie, 'GET', `/api/lists/${listId}/items`)
    const rows = (await items.json()) as { id: string; packSortOrder: number }[]
    // A genuine permutation of the current ranks: swap the two.
    return [
      { id: rows[0]!.id, packSortOrder: rows[1]!.packSortOrder },
      { id: rows[1]!.id, packSortOrder: rows[0]!.packSortOrder },
    ]
  }

  it('maps a rank collision (unique index) to conflict', async () => {
    const { cookie, userId } = await newUser('rp1')
    const listId = await createList(cookie, 'Trip')
    const updates = await seedTwoItemCohort(cookie, listId)

    const repo = createListItemsRepo(
      failing(raw(), 'batch', rankCollision()),
      userId,
    )
    const result = await repo.reorderPack(listId, updates)
    expect(result).toEqual({ ok: false, reason: 'conflict' })
  })

  it('maps the park guard firing (NOT NULL) to conflict', async () => {
    const { cookie, userId } = await newUser('rp2')
    const listId = await createList(cookie, 'Trip')
    const updates = await seedTwoItemCohort(cookie, listId)

    const guardViolation = new Error('D1_ERROR', {
      cause: new Error(
        'NOT NULL constraint failed: _pack_reorder_guard.ok: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_NOTNULL)',
      ),
    })
    const repo = createListItemsRepo(failing(raw(), 'batch', guardViolation), userId)
    const result = await repo.reorderPack(listId, updates)
    expect(result).toEqual({ ok: false, reason: 'conflict' })
  })

  it('the route answers the conflict with the 409 dialect', async () => {
    // The real listRoutes module, with only the repos context stubbed to
    // return the conflict result - so the route-side mapping (the branch the
    // matrix's 409 row points at) is exercised end to end.
    const { Hono } = await import('hono')
    const { listRoutes } = await import('../routes/lists')
    const testApp = new Hono<{ Variables: { repos: unknown } }>()
    testApp.use('*', async (c, next) => {
      c.set('repos', {
        listItems: {
          reorderPack: async () => ({ ok: false, reason: 'conflict' }),
        },
      })
      await next()
    })
    testApp.route('/lists', listRoutes)

    const res = await testApp.request('/lists/some-list/items/pack-order', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([{ id: 'a', packSortOrder: 0 }]),
    })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({
      error: 'This bag changed while you were reordering',
    })
  })
})
