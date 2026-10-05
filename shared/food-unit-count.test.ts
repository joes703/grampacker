import { describe, expect, it } from 'vitest'
import { foodUnitCount } from './food'

// The whole of 0024 in one function: how many of a thing you carry.
//
// It lives in shared/ and is imported by the repo that publishes it, so the
// owner's page, the pack list and the anonymous share cannot disagree. The
// last time a food total was computed in more than one place, the share
// reported a lighter pack than the owner's own view of the same list.
describe('foodUnitCount', () => {
  const slots = (n: number) => Array.from({ length: n }, (_, i) => `s${i}`)

  describe('per meal - the default, and the case that was broken', () => {
    it('multiplies the per-meal count by the meals', () => {
      // Two bars at each of five lunches is ten bars, not two.
      expect(
        foodUnitCount({ quantity: 2, isPerMeal: true, slotIds: slots(5) }),
      ).toBe(10)
    })

    it('counts one meal\'s worth when nothing is scheduled yet', () => {
      // NOT zero. You have added it, it is in the pack, and the row already
      // carries an "Unscheduled" badge to say the plan is incomplete. A
      // weightless item would hide real grams behind a UI hint.
      expect(
        foodUnitCount({ quantity: 3, isPerMeal: true, slotIds: [] }),
      ).toBe(3)
    })
  })

  describe('shared - the case the old contract was protecting', () => {
    it('is the total, however many meals it spans', () => {
      // One bag of trail mix picked at across several lunches is one bag.
      expect(
        foodUnitCount({ quantity: 4, isPerMeal: false, slotIds: slots(3) }),
      ).toBe(4)
    })

    it('does not fall back to one when unscheduled', () => {
      expect(
        foodUnitCount({ quantity: 2, isPerMeal: false, slotIds: [] }),
      ).toBe(2)
    })
  })
})
