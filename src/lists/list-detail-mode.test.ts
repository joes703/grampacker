import { describe, expect, it } from 'vitest'
import {
  deriveListMode,
  isLegacyOrganizePath,
  listDocumentTitle,
  persistedListPath,
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
  ] as const)('%s%s -> %s', (pathname, search, expected) => {
    expect(deriveListMode(pathname, search, LIST_ID)).toBe(expected)
  })
})

describe('isLegacyOrganizePath', () => {
  it.each([
    [`/lists/${LIST_ID}/organize`, true],
    [`/lists/${LIST_ID}/pack/organize`, true],
    [`/lists/${LIST_ID}/pack`, false],
    [`/lists/${LIST_ID}`, false],
    // Belongs to a different list, so this page must not rewrite the URL.
    ['/lists/other-list/organize', false],
  ] as const)('%s -> %s', (pathname, expected) => {
    expect(isLegacyOrganizePath(pathname, LIST_ID)).toBe(expected)
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
