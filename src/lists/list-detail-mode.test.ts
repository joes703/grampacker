import { describe, expect, it } from 'vitest'
import {
  deriveListMode,
  isLegacyListPath,
  isLegacyOrganizePath,
  listDocumentTitle,
  persistedListPath,
  searchAfterLegacyRedirect,
} from './list-detail-mode'

const LIST_ID = 'list-1'

describe('deriveListMode', () => {
  it.each([
    [`/lists/${LIST_ID}`, '', 'edit'],
    [`/lists/${LIST_ID}/pack`, '', 'pack'],
    // Organize merged INTO Pack, so its retired URLs resolve to Pack rather
    // than falling through to Edit. Falling through would silently drop a
    // returning bookmark into the wrong view instead of the one that
    // replaced Organize.
    [`/lists/${LIST_ID}/organize`, '', 'pack'],
    [`/lists/${LIST_ID}/pack/organize`, '', 'pack'],
    [`/lists/${LIST_ID}`, '?mode=pack', 'pack'],
    [`/lists/${LIST_ID}`, '?mode=PACK', 'edit'],
    [`/lists/${LIST_ID}/food`, '', 'food'],
    // A food URL with a legacy pack query param is a food URL; path wins.
    [`/lists/${LIST_ID}/food`, '?mode=pack', 'food'],
    // Router matching is case-insensitive and slash-tolerant; mode
    // derivation must agree or these URLs render the wrong view.
    [`/lists/${LIST_ID}/FOOD`, '', 'food'],
    [`/lists/${LIST_ID}/food/`, '', 'food'],
    [`/lists/${LIST_ID}/PACK`, '', 'pack'],
    [`/lists/${LIST_ID}/pack/`, '', 'pack'],
    // The retired spellings get the same tolerance as the live ones.
    [`/lists/${LIST_ID}/organize/`, '', 'pack'],
    [`/lists/${LIST_ID}/ORGANIZE`, '', 'pack'],
    [`/lists/${LIST_ID}/pack/organize/`, '', 'pack'],
    [`/lists/${LIST_ID}/`, '?mode=pack', 'pack'],
    [`/LISTS/${LIST_ID.toUpperCase()}`, '?mode=pack', 'pack'],
  ] as const)('%s%s -> %s', (pathname, search, expected) => {
    expect(deriveListMode(pathname, search, LIST_ID)).toBe(expected)
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
    [`/lists/${LIST_ID}/organize`, ''],
    [`/lists/${LIST_ID}/organize/`, ''],
    [`/lists/${LIST_ID}/pack/organize`, ''],
    [`/lists/${LIST_ID}/PACK/ORGANIZE/`, ''],
    [`/lists/${LIST_ID}`, '?mode=pack'],
    [`/lists/${LIST_ID}/`, '?mode=pack'],
    [`/lists/${LIST_ID}`, '?other=1&mode=pack'],
  ] as const

  it.each(legacy)('%s%s is legacy', (pathname, search) => {
    expect(isLegacyListPath(pathname, search, LIST_ID)).toBe(true)
  })

  it.each([
    // Canonical shapes are never rewritten, whatever the query says.
    [`/lists/${LIST_ID}`, ''],
    [`/lists/${LIST_ID}/pack`, ''],
    [`/lists/${LIST_ID}/pack/`, '?mode=pack'],
    [`/lists/${LIST_ID}/food`, '?mode=pack'],
    // The query value was always matched exactly.
    [`/lists/${LIST_ID}`, '?mode=PACK'],
    [`/lists/${LIST_ID}`, '?mode=edit'],
    // Another list's retired URL is not this page's to rewrite.
    ['/lists/other-list', '?mode=pack'],
  ] as const)('%s%s is not legacy', (pathname, search) => {
    expect(isLegacyListPath(pathname, search, LIST_ID)).toBe(false)
  })

  it('agrees with deriveListMode on every legacy spelling', () => {
    for (const [pathname, search] of legacy) {
      expect(deriveListMode(pathname, search, LIST_ID)).toBe('pack')
    }
  })

  it('never classifies the rewrite target as legacy, so the rewrite runs once', () => {
    // ListDetailPage navigates to this exact path with the search dropped;
    // if it were legacy too the effect would fire again on arrival.
    const target = persistedListPath(LIST_ID, 'pack')
    expect(isLegacyListPath(target, '', LIST_ID)).toBe(false)
    expect(isLegacyListPath(target, '?mode=pack', LIST_ID)).toBe(false)
    expect(isLegacyListPath(target, '?keep=1', LIST_ID)).toBe(false)
    expect(deriveListMode(target, '', LIST_ID)).toBe('pack')
  })
})

// What the rewrite carries along: everything but the consumed `mode=pack`.
describe('searchAfterLegacyRedirect', () => {
  it.each([
    ['', ''],
    ['?mode=pack', ''],
    ['?keep=1&mode=pack', '?keep=1'],
    ['?mode=pack&keep=1&also=2', '?keep=1&also=2'],
    ['?mode=pack&mode=pack', ''],
    ['?mode=pack&', ''],
    // A second, different mode value is not the consumed one.
    ['?mode=pack&mode=edit', '?mode=edit'],
    // Survivors keep their raw text and order: no `%20` -> `+`, no case
    // change in escapes, no `=` added to a bare key, no replacement of an
    // undecodable byte, no merging of duplicate keys.
    ['?mode=pack&q=a%20b&flag&x=%2f', '?q=a%20b&flag&x=%2f'],
    ['?opaque=%FF&mode=pack', '?opaque=%FF'],
    ['?a=1&mode=pack&a=2', '?a=1&a=2'],
    // Consumption is by DECODED reading, the one deriveListMode uses.
    ['?m%6Fde=pack&keep=1', '?keep=1'],
    ['?mode=pa%63k', ''],
    // A key that itself starts with `?` is not `mode`; the whole-string parse
    // reads it as `?mode`, and so must the per-entry one.
    ['?mode=pack&?mode=pack&keep=1', '??mode=pack&keep=1'],
    ['?a&&mode=pack&b', '?a&&b'],
  ] as const)('%s -> %s', (search, expected) => {
    expect(searchAfterLegacyRedirect(search)).toBe(expected)
  })

  it.each([
    // Nothing consumed, so the string is returned verbatim - not even
    // re-encoded (`%20` would otherwise become `+`).
    '?keep=1',
    '?mode=PACK',
    '?mode=pack+',
    '?mode%3Dpack',
    '??mode=pack',
    '?mode=edit&keep=1',
    '?q=a%20b',
    '',
  ])('returns %s unchanged', (search) => {
    expect(searchAfterLegacyRedirect(search)).toBe(search)
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
