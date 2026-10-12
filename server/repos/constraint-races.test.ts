import { env, testDb } from '../test/node-env'
import Database from 'better-sqlite3'
import { describe, expect, it, vi } from 'vitest'
import { createDb, type Db } from '../db'
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
// SQLite foreign-key error, and the recovery path re-probes real database
// state - nothing about the error or the probes is simulated.

// Repositories not yet converted to transactions write through runBatch(db,
// statements) (server/db/index.ts). A batch hook registered for a wrapped db
// handle runs immediately before that handle's batch executes - the same
// window D1's db.batch() left open. Keyed by handle, so only the repo built on
// the wrapped handle is affected.
const batchHooks = vi.hoisted(
  () => new WeakMap<object, () => Promise<void>>(),
)
vi.mock('../db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../db')>()
  return {
    ...actual,
    runBatch: (async (db, statements) => {
      const hook = batchHooks.get(db)
      if (hook) await hook()
      return actual.runBatch(db, statements)
    }) as typeof actual.runBatch,
  }
})

const raw = () => createDb(env.DB)

async function newUser(tag: string) {
  const email = `race-${tag}@example.com`
  const { cookie } = await signUpVerifiedUser(email, `R-${tag}`)
  const row = await testDb.prepare('select id from user where email = ?')
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

// Wraps a db handle so the (skip+1)th operation executed through `method`
// runs `sabotage` immediately before it. `skip` exists because some
// PRECHECKS also use the method, and the point is to corrupt the
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
    const wrapped = new Proxy(db, {}) as Db
    batchHooks.set(wrapped, pre)
    return wrapped
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
// the real one: a Drizzle-style wrapper with better-sqlite3's SqliteError (the
// raw message and its extended code) at the root cause, which is where the
// matchers look. `skip` passes the
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
  if (method === 'batch') {
    const wrapped = new Proxy(db, {}) as Db
    batchHooks.set(wrapped, async () => {
      if (shouldFail()) throw err
    })
    return wrapped
  }
  return new Proxy(db, {
    get(target, prop, receiver) {
      if (prop === method) {
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

const rankCollision = () =>
  new Error('Failed query', {
    cause: new Database.SqliteError(
      'UNIQUE constraint failed: list_items.list_id, list_items.packing_location_id, list_items.pack_sort_order',
      'SQLITE_CONSTRAINT_UNIQUE',
    ),
  })

describe('addExisting loses a race', () => {
  it('gear deleted after the precheck -> invalid_gear', async () => {
    const { cookie, userId } = await newUser('li1')
    const listId = await createList(cookie, 'Trip')
    const gearId = await createGear(cookie, 'Stove')

    const repo = createListItemsRepo(
      sabotaged(raw(), 'insert', async () => {
        await testDb.prepare('delete from gear_items where id = ?')
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
        await testDb.prepare('delete from lists where id = ?').bind(listId).run()
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
        await testDb.prepare('delete from gear_items where id = ?')
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
        await testDb.prepare('delete from categories where id = ?')
          .bind(categoryId)
          .run()
      }),
      userId,
    )
    const result = await repo.importFromCsv(importInput(null, categoryId))
    expect(result).toEqual({ ok: false, reason: 'invalid_category' })
  })
})

// Packing-location create, pack reorder and location delete no longer appear
// here: each runs its reads, checks and writes in one SQLite transaction, so
// the window these tests staged between a precheck and its write does not
// exist. server/repos/pack-transactions.test.ts proves the transactions are
// all-or-nothing instead.

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
describe('pack-order and location-delete routes keep their 409 dialect', () => {
  it('the location-delete route answers a fallback conflict with 409', async () => {
    const { Hono } = await import('hono')
    const { packingLocationRoutes } = await import('../routes/packing-locations')
    const testApp = new Hono<{ Variables: { repos: unknown } }>()
    testApp.use('*', async (c, next) => {
      c.set('repos', {
        packingLocations: { remove: async () => 'conflict' as const },
      })
      await next()
    })
    testApp.route('/lists', packingLocationRoutes)

    const res = await testApp.request('/lists/some-list/packing-locations/some-loc', {
      method: 'DELETE',
    })
    expect(res.status).toBe(409)
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
        packReorder: {
          reorder: async () => ({ ok: false, reason: 'conflict' }),
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
