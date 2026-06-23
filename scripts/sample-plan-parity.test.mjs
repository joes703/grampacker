import { describe, expect, it } from 'vitest'
import * as mjs from './food-design-sample-data.mjs'
import * as ts from '../src/lib/food/sample-plan'

// The CLI seed script (scripts/food-design-sample-data.mjs) and the in-app
// "Load sample plan" dataset (src/lib/food/sample-plan.ts) are two hand-written
// copies of the same Wind River fixture. This guards them against drift: if a
// food value, meal, target, day, or extra changes in one and not the other,
// this fails. Keep both in sync (or unify them) when editing the sample.
describe('sample-plan dataset parity (CLI .mjs vs app .ts)', () => {
  it('foods match', () => {
    expect(ts.FOODS).toEqual(mjs.FOODS)
  })
  it('meals match', () => {
    expect(ts.MEALS).toEqual(mjs.MEALS)
  })
  it('daily targets match', () => {
    expect(ts.DAILY_TARGETS).toEqual(mjs.DAILY_TARGETS)
  })
  it('days match', () => {
    expect(ts.DAYS).toEqual(mjs.DAYS)
  })
  it('extras match', () => {
    expect(ts.EXTRAS).toEqual(mjs.EXTRAS)
  })
})
