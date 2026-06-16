import { describe, it, expect, beforeEach, vi } from 'vitest'

type Recorded = {
  table: string
  eqArgs: [string, unknown][]
  orderArgs: [string, Record<string, unknown> | undefined][]
}

const mockState = vi.hoisted(() => ({
  calls: [] as Recorded[],
  // Per-table response rows, keyed by exact table name. Tests set these.
  responses: {} as Record<string, unknown[]>,
}))

vi.mock('../supabase', () => ({
  supabase: {
    from(table: string) {
      const rec: Recorded = { table, eqArgs: [], orderArgs: [] }
      mockState.calls.push(rec)
      const builder: Record<string, unknown> = {
        select() {
          return builder
        },
        eq(col: string, val: unknown) {
          rec.eqArgs.push([col, val])
          return builder
        },
        order(col: string, opts?: Record<string, unknown>) {
          rec.orderArgs.push([col, opts])
          return builder
        },
        then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
          return Promise.resolve({
            data: mockState.responses[table] ?? [],
            error: null,
          }).then(resolve, reject)
        },
      }
      return builder
    },
  },
  // food-plan.ts also imports publicSupabase at module scope.
  publicSupabase: {},
}))

import { fetchAllUserFoodData } from './food-plan'

const EXPECTED_TABLES = [
  'food_plans',
  'meals',
  'food_plan_days',
  'day_meals',
  'food_plan_entries',
  'food_plan_daily_targets',
  'meal_targets',
  'food_plan_target_defaults',
]

function orderColsFor(table: string): string[] {
  const call = mockState.calls.find((c) => c.table === table)
  if (!call) throw new Error(`no call recorded for ${table}`)
  return call.orderArgs.map(([col]) => col)
}

describe('fetchAllUserFoodData', () => {
  beforeEach(() => {
    mockState.calls = []
    mockState.responses = {}
  })

  it('queries exactly the eight food-plan tables, never food_items or food_pack_state', async () => {
    await fetchAllUserFoodData('user-1')
    const tables = mockState.calls.map((c) => c.table)
    expect(new Set(tables)).toEqual(new Set(EXPECTED_TABLES))
    expect(tables).not.toContain('food_items')
    expect(tables).not.toContain('food_pack_state')
  })

  it('scopes every query to the owner', async () => {
    await fetchAllUserFoodData('user-1')
    for (const call of mockState.calls) {
      expect(call.eqArgs).toContainEqual(['user_id', 'user-1'])
    }
  })

  it('orders each table deterministically, with nulls last on the nullable sort column', async () => {
    await fetchAllUserFoodData('user-1')
    expect(orderColsFor('food_plans')).toEqual(['list_id', 'id'])
    expect(orderColsFor('meals')).toEqual(['food_plan_id', 'sort_order', 'id'])
    expect(orderColsFor('food_plan_days')).toEqual(['food_plan_id', 'sort_order', 'id'])
    expect(orderColsFor('day_meals')).toEqual(['food_plan_id', 'day_id', 'meal_id', 'id'])
    expect(orderColsFor('food_plan_entries')).toEqual([
      'food_plan_id', 'day_meal_id', 'is_extra', 'sort_order', 'id',
    ])
    expect(orderColsFor('food_plan_daily_targets')).toEqual(['food_plan_id', 'metric', 'id'])
    expect(orderColsFor('meal_targets')).toEqual(['food_plan_id', 'meal_id', 'metric', 'id'])
    expect(orderColsFor('food_plan_target_defaults')).toEqual(['metric', 'id'])

    const entryOrder = mockState.calls.find((c) => c.table === 'food_plan_entries')!.orderArgs
    const dayMealOpts = entryOrder.find(([col]) => col === 'day_meal_id')![1]
    expect(dayMealOpts).toMatchObject({ nullsFirst: false })
  })

  it('returns rows keyed by exact table name, with no food_items or food_pack_state key', async () => {
    mockState.responses['food_plans'] = [{ id: 'p1' }]
    mockState.responses['meal_targets'] = [{ id: 'mt1' }]
    const result = await fetchAllUserFoodData('user-1')
    expect(result.food_plans).toEqual([{ id: 'p1' }])
    expect(result.meal_targets).toEqual([{ id: 'mt1' }])
    expect(result).not.toHaveProperty('food_items')
    expect(result).not.toHaveProperty('food_pack_state')
  })

  it('is empty-safe when the user has no food data', async () => {
    const result = await fetchAllUserFoodData('user-1')
    expect(result.food_plans).toEqual([])
    expect(result.meals).toEqual([])
    expect(result.food_plan_days).toEqual([])
    expect(result.day_meals).toEqual([])
    expect(result.food_plan_entries).toEqual([])
    expect(result.food_plan_daily_targets).toEqual([])
    expect(result.meal_targets).toEqual([])
    expect(result.food_plan_target_defaults).toEqual([])
  })
})
