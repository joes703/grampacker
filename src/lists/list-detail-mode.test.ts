import { describe, expect, it } from 'vitest'
import {
  deriveListMode,
  isLegacyListPath,
  isLegacyOrganizePath,
  listDocumentTitle,
  persistedListPath,
} from './list-detail-mode'

const LIST_ID = 'list-1'

describe('deriveListMode', () => {
  it.each([
    [`/lists/${LIST_ID}`, 'edit'],
    [`/lists/${LIST_ID}/pack`, 'pack'],
    // Organize merged INTO Pack, so its retired URLs resolve to Pack rather
    // than falling through to Edit. Falling through would silently drop a
    // returning bookmark into the wrong view instead of the one that
    // replaced Organize.
    [`/lists/${LIST_ID}/organize`, 'pack'],
    [`/lists/${LIST_ID}/pack/organize`, 'pack'],
    [`/lists/${LIST_ID}/food`, 'food'],
    // Router matching is case-insensitive and slash-tolerant; mode
    // derivation must agree or these URLs render the wrong view.
    [`/lists/${LIST_ID}/FOOD`, 'food'],
    [`/lists/${LIST_ID}/food/`, 'food'],
    [`/lists/${LIST_ID}/pack/`, 'pack'],
    // The retired spellings get the same tolerance as the live ones.
    [`/lists/${LIST_ID}/organize/`, 'pack'],
    [`/lists/${LIST_ID}/ORGANIZE`, 'pack'],
    [`/lists/${LIST_ID}/pack/organize/`, 'pack'],
  ] as const)('%s -> %s', (pathname, expected) => {
    expect(deriveListMode(pathname, LIST_ID)).toBe(expected)
  })

  // The router takes the list id from the URL as typed, so an upper-case URL
  // arrives with an upper-case id. The id must be case-folded too.
  it('/LISTS/LIST-1/PACK, with the id the router reads from it -> pack', () => {
    expect(deriveListMode('/LISTS/LIST-1/PACK', 'LIST-1')).toBe('pack')
  })
})

describe('isLegacyOrganizePath', () => {
  it.each([
    [`/lists/${LIST_ID}/organize`, true],
    [`/lists/${LIST_ID}/pack/organize`, true],
    // The router resolves these to the same routes, so the predicate has to
    // agree with it - an exact match here once let /organize/ render Pack
    // without the address-bar rewrite.
    [`/lists/${LIST_ID}/organize/`, true],
    [`/lists/${LIST_ID}/ORGANIZE`, true],
    [`/LISTS/${LIST_ID.toUpperCase()}/pack/organize//`, true],
    [`/lists/${LIST_ID}/pack`, false],
    [`/lists/${LIST_ID}`, false],
  ] as const)('%s -> %s', (pathname, expected) => {
    expect(isLegacyOrganizePath(pathname, LIST_ID)).toBe(expected)
  })
})

// The one predicate behind both the address-bar rewrite (ListDetailPage) and
// the 'pack' answer for retired URLs (deriveListMode).
describe('isLegacyListPath', () => {
  const legacy = [
    `/lists/${LIST_ID}/organize`,
    `/lists/${LIST_ID}/organize/`,
    `/lists/${LIST_ID}/pack/organize`,
    `/lists/${LIST_ID}/PACK/ORGANIZE/`,
  ]

  it.each(legacy)('%s is legacy', (pathname) => {
    expect(isLegacyListPath(pathname, LIST_ID)).toBe(true)
  })

  it.each([
    // Canonical shapes are never rewritten.
    `/lists/${LIST_ID}`,
    `/lists/${LIST_ID}/pack`,
  ])('%s is not legacy', (pathname) => {
    expect(isLegacyListPath(pathname, LIST_ID)).toBe(false)
  })

  it('agrees with deriveListMode on every legacy spelling', () => {
    for (const pathname of legacy) {
      expect(deriveListMode(pathname, LIST_ID)).toBe('pack')
    }
  })

  it('never classifies the rewrite target as legacy, so the rewrite runs once', () => {
    // ListDetailPage navigates to this exact path, keeping the search string;
    // if it were legacy too the effect would fire again on arrival.
    const target = persistedListPath(LIST_ID, 'pack')
    expect(isLegacyListPath(target, LIST_ID)).toBe(false)
    expect(deriveListMode(target, LIST_ID)).toBe('pack')
  })
})

describe('persistedListPath', () => {
  it.each([
    ['edit', `/lists/${LIST_ID}`],
    ['pack', `/lists/${LIST_ID}/pack`],
  ] as const)('persists %s mode', (mode, expected) => {
    expect(persistedListPath(LIST_ID, mode)).toBe(expected)
  })

  it('persists the food view path', () => {
    expect(persistedListPath(LIST_ID, 'food')).toBe(`/lists/${LIST_ID}/food`)
  })
})

describe('listDocumentTitle', () => {
  it.each([
    ['edit', 'Weekend Trip - Category'],
    ['pack', 'Weekend Trip - Pack'],
  ] as const)('names the %s browser view', (mode, expected) => {
    expect(listDocumentTitle('Weekend Trip', mode)).toBe(expected)
  })

  it('titles the food view', () => {
    expect(listDocumentTitle('JMT', 'food')).toBe('JMT - Food')
  })
})
