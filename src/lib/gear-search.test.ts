import { describe, expect, it } from 'vitest'
import { filterGearBySearch } from './gear-search'

const tent = { name: 'Tent', description: 'Two-person shelter' }
const stove = { name: 'Stove', description: null }

// The gear library and the list page's gear picker search the same way.
describe('filterGearBySearch', () => {
  it('matches the name or the description, ignoring case', () => {
    expect(filterGearBySearch([tent, stove], 'SHELTER')).toEqual([tent])
    expect(filterGearBySearch([tent, stove], 'sto')).toEqual([stove])
  })

  it('ignores surrounding spaces, and returns everything for an empty search', () => {
    const items = [tent, stove]
    expect(filterGearBySearch(items, '  tent ')).toEqual([tent])
    expect(filterGearBySearch(items, '   ')).toBe(items)
  })
})
