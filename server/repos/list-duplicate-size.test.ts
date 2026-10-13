import { env } from '../test/node-env'
import { describe, expect, it } from 'vitest'
import { createDb, type Sqlite } from '../db'
import { listFoodItemSlots } from '../db/schema'
import { apiRequest } from '../test/api-helpers'
import { signUpVerifiedUser } from '../test/auth-helpers'
import { FOOD_DAY_CAP, FOOD_ITEM_CAP, FOOD_SLOT_CAP } from '../../shared/food'
import { rowsPerStatement } from './chunk-ids'
import { createListsRepo } from './lists'

// List duplication at the largest size the caps allow. Its food associations
// are the one write in the app that cannot fit in one statement: FOOD_ITEM_CAP
// x FOOD_SLOT_CAP rows at 4 parameters each is more than SQLite's 32766. This
// proves, against real SQLite, that the chunked copy succeeds whole and that
// it takes a handful of statements rather than hundreds.

// Counts every statement Drizzle prepares that matches `pattern`. Everything
// else passes through to the real connection, so the duplicate runs for real.
function countingConnection(sqlite: Sqlite, pattern: RegExp) {
  const counter = { n: 0 }
  const proxy = new Proxy(sqlite, {
    get(target, prop) {
      if (prop === 'prepare') {
        return (sql: string) => {
          if (pattern.test(sql)) counter.n += 1
          return target.prepare(sql)
        }
      }
      const value = Reflect.get(target, prop, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
  return { proxy, counter }
}

describe('list duplication at the food caps', () => {
  it('copies every food association in a few statements', { timeout: 60000 }, async () => {
    const { cookie } = await signUpVerifiedUser('dup-size@example.com', 'Size')
    const me = (await (await apiRequest(cookie, 'GET', '/api/me')).json()) as { id: string }
    const created = await apiRequest(cookie, 'POST', '/api/lists', { name: 'Thru hike' })
    const listId = ((await created.json()) as { id: string }).id

    expect((await apiRequest(cookie, 'PUT', `/api/lists/${listId}/food/days`, { days: FOOD_DAY_CAP })).status).toBe(200)
    const food = (await (await apiRequest(cookie, 'GET', `/api/lists/${listId}/food`)).json()) as {
      slots: { id: string }[]
    }
    const slotIds = food.slots.map((s) => s.id)
    expect(slotIds).toHaveLength(FOOD_SLOT_CAP)
    for (let i = 0; i < FOOD_ITEM_CAP; i++) {
      const res = await apiRequest(cookie, 'POST', `/api/lists/${listId}/food/items`, {
        name: `Meal ${i}`,
        weightGrams: 100,
        quantity: 1,
        slotIds,
      })
      expect(res.status, `item ${i}`).toBe(201)
    }

    const links = (id: string) =>
      (env.DB.prepare('select count(*) as n from list_food_item_slots where list_id = ?').get(id) as {
        n: number
      }).n
    const total = FOOD_ITEM_CAP * FOOD_SLOT_CAP
    expect(links(listId)).toBe(total)
    // The point of chunking: one statement for all of them would not bind.
    expect(total * 4).toBeGreaterThan(32766)

    const { proxy, counter } = countingConnection(env.DB, /^insert into "list_food_item_slots"/i)
    const result = await createListsRepo(createDb(proxy), me.id).duplicate(listId)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(links(result.row.id)).toBe(total)
    expect(counter.n).toBe(Math.ceil(total / rowsPerStatement(listFoodItemSlots)))
    expect(counter.n).toBeLessThanOrEqual(10)
  })
})
