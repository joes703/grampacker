import { env } from '../test/node-env'
import { describe, expect, it } from 'vitest'
import { createDb } from '../db'
import { apiRequest } from '../test/api-helpers'
import { signUpVerifiedUser } from '../test/auth-helpers'
import { FOOD_DAY_CAP, FOOD_ITEM_CAP, FOOD_SLOT_CAP } from '../../shared/food'
import { createListsRepo } from './lists'

// The association INSERT would exceed SQLite's parameter limit without
// splitting. Assert the completed copy, without pinning a chunk-size margin.
describe('list duplication at the food caps', () => {
  it('copies every food association without changing the source', { timeout: 60000 }, async () => {
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

    const result = await createListsRepo(createDb(env.DB), me.id).duplicate(listId)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(links(result.row.id)).toBe(total)
    expect(links(listId)).toBe(total)
  })
})
