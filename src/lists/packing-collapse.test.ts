// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { readPackingCollapsed, writePackingCollapsed } from './packing-collapse'

beforeEach(() => localStorage.clear())

describe('packing location collapse persistence', () => {
  it('round-trips a list-scoped set', () => {
    writePackingCollapsed('list-a', new Set(['loc-1', 'loc-2']))
    expect(readPackingCollapsed('list-a')).toEqual(new Set(['loc-1', 'loc-2']))
    expect(readPackingCollapsed('list-b')).toEqual(new Set())
  })

  it('fails closed on malformed or non-string stored entries', () => {
    localStorage.setItem('packingCollapsed:list-a', JSON.stringify(['loc-1', 42]))
    expect(readPackingCollapsed('list-a')).toEqual(new Set())
    localStorage.setItem('packingCollapsed:list-a', '{bad json')
    expect(readPackingCollapsed('list-a')).toEqual(new Set())
  })
})
