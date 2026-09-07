import { describe, expect, it } from 'vitest'
import { gearKey } from './sort-keys'

// Direct tests for the CSV import planner's dedup key. These moved here from
// src/lib/queries/sort-keys.test.ts, which was testing a byte-identical COPY of
// this function that nothing imported - so the NFC regression below was
// guarding the dead copy while the live one (import-plan.ts) had no direct
// coverage of it at all.
//
// The two spellings of "cafe" are written as \u escapes, NOT as literal
// characters. The original test held the raw bytes, which is fragile in a way
// that fails SILENTLY: an editor or tool that normalizes the file to NFC turns
// the decomposed literal into the precomposed one, and the assertion then
// compares a string to itself and passes while proving nothing. That happened
// while moving this file. Escapes cannot be normalized.

const PRECOMPOSED = 'caf\u00e9' // é as one codepoint (U+00E9)
const DECOMPOSED = 'cafe\u0301' // e + combining acute (U+0301)

describe('gearKey', () => {
  it('normalizes to NFC before lowercasing, so NFD re-imports match', () => {
    // Guard the fixture itself: if these ever become equal the assertion below
    // is vacuous, which is exactly the failure this test cannot afford.
    expect(PRECOMPOSED).not.toBe(DECOMPOSED)
    expect(gearKey('c1', PRECOMPOSED, 100)).toBe(gearKey('c1', DECOMPOSED, 100))
    expect(gearKey('c1', 'CAF\u00c9', 100)).toBe(gearKey('c1', PRECOMPOSED, 100))
  })

  it('distinguishes category, name, and weight', () => {
    expect(gearKey('c1', 'Tent', 900)).not.toBe(gearKey('c2', 'Tent', 900))
    expect(gearKey('c1', 'Tent', 900)).not.toBe(gearKey('c1', 'Tarp', 900))
    expect(gearKey('c1', 'Tent', 900)).not.toBe(gearKey('c1', 'Tent', 901))
    expect(gearKey(null, 'Tent', 900)).not.toBe(gearKey('c1', 'Tent', 900))
  })
})
