import { describe, it, expect } from 'vitest'
import { toGrams, weightIsUnreadable } from './units'
import { MAX_ITEM_WEIGHT_GRAMS } from '../caps'

describe('toGrams', () => {
  it('passes grams through for empty / g / gram / grams and unknown units', () => {
    // Empty + g/gram/grams take the grams default; a typo'd unit ("kgs")
    // also falls back to grams as the most-tolerant CSV-import behavior.
    expect(toGrams('100', '')).toBe(100)
    expect(toGrams('100', 'g')).toBe(100)
    expect(toGrams('100', 'gram')).toBe(100)
    expect(toGrams('100', 'grams')).toBe(100)
    expect(toGrams('100', 'kgs')).toBe(100)
  })

  it('converts ounce aliases (oz / ounce / ounces)', () => {
    // Keeps the tenths: rounding to whole grams would discard up to 0.5 g on
    // every row of an ounce-denominated import.
    expect(toGrams('3', 'oz')).toBe(85) // 3 * 28.3495 = 85.0485
    expect(toGrams('2.5', 'ounces')).toBe(70.9) // 70.87375
    expect(toGrams('1', 'ounce')).toBe(28.3) // 28.3495
  })

  it('converts pound aliases (lb / pound / pounds)', () => {
    expect(toGrams('1', 'lb')).toBe(453.6) // 453.592
    expect(toGrams('1', 'pound')).toBe(453.6)
    expect(toGrams('2', 'pounds')).toBe(907.2) // 907.184
  })

  it('converts kilogram aliases (kg / kilogram / kilograms)', () => {
    expect(toGrams('1.5', 'kg')).toBe(1500)
    expect(toGrams('1.5', 'kilogram')).toBe(1500)
    expect(toGrams('0.5', 'kilograms')).toBe(500)
  })

  it('is case- and whitespace-insensitive on the unit', () => {
    expect(toGrams('1', ' KG ')).toBe(1000)
    expect(toGrams('1', 'Oz')).toBe(28.3)
  })

  it('returns 0 for NaN / non-numeric weights', () => {
    expect(toGrams('abc', 'g')).toBe(0)
    expect(toGrams('', 'g')).toBe(0)
  })

  it('returns 0 for negative weights', () => {
    expect(toGrams('-5', 'g')).toBe(0)
    expect(toGrams('-1', 'kg')).toBe(0)
  })

  it('rounds to the nearest tenth of a gram', () => {
    // shared/gear.ts caps stored weights at 1 decimal place. A parser that
    // returned 1.44 would produce rows the server rejects wholesale.
    expect(toGrams('1.4', 'g')).toBe(1.4)
    expect(toGrams('1.44', 'g')).toBe(1.4)
    expect(toGrams('1.46', 'g')).toBe(1.5)
  })

  it('clamps to MAX_ITEM_WEIGHT_GRAMS', () => {
    // 101 kg = 101000 g, above the 100000 g cap.
    expect(toGrams('101', 'kg')).toBe(MAX_ITEM_WEIGHT_GRAMS)
    expect(toGrams(String(MAX_ITEM_WEIGHT_GRAMS + 1), 'g')).toBe(MAX_ITEM_WEIGHT_GRAMS)
  })
})

describe('weightIsUnreadable', () => {
  it('treats a unit named like an object property as unknown', () => {
    expect(toGrams('5', 'constructor')).toBe(5)
    expect(weightIsUnreadable('5', 'constructor')).toBe(true)
  })

  it.each([
    ['100', ''],
    ['100', 'g'],
    ['100', 'gram'],
    ['100', 'grams'],
    ['4.2', 'oz'],
    ['4.2', 'ounce'],
    ['1', 'lb'],
    ['1', 'pounds'],
    ['2', 'KG'],
    [' 100 ', ' g '],
    ['.5', 'oz'],
    ['0', 'g'],
    ['100000', 'g'],
    ['100', 'kilograms'],
  ])('reads %j %j', (value, unit) => {
    expect(weightIsUnreadable(value, unit)).toBe(false)
  })

  it('does not flag a blank weight, which is how a Lighterpack export says none', () => {
    expect(weightIsUnreadable('', 'g')).toBe(false)
    expect(weightIsUnreadable('   ', '')).toBe(false)
  })

  it.each([
    ['abc', 'g'],
    ['12abc', 'g'],
    ['1,200', 'g'], // parseFloat reads this as 1
    ['-5', 'g'],
    ['100001', 'g'],
    ['101', 'kg'], // over the limit only after converting
    ['5', 'kgs'], // saved as 5 g
    ['0x10', 'g'],
  ])('flags %j %j', (value, unit) => {
    expect(weightIsUnreadable(value, unit)).toBe(true)
  })
})
