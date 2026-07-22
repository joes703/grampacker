import { describe, expect, it } from 'vitest'
import {
  deriveListMode,
  listDocumentTitle,
  persistedListPath,
} from './list-detail-mode'

const LIST_ID = 'list-1'

describe('deriveListMode', () => {
  it.each([
    [`/lists/${LIST_ID}`, '', 'edit'],
    [`/lists/${LIST_ID}/pack`, '', 'pack'],
    [`/lists/${LIST_ID}/organize`, '', 'organize'],
    [`/lists/${LIST_ID}/pack/organize`, '', 'organize'],
    [`/lists/${LIST_ID}`, '?mode=pack', 'pack'],
    [`/lists/${LIST_ID}`, '?mode=PACK', 'edit'],
  ] as const)('%s%s -> %s', (pathname, search, expected) => {
    expect(deriveListMode(pathname, search, LIST_ID)).toBe(expected)
  })
})

describe('persistedListPath', () => {
  it.each([
    ['edit', `/lists/${LIST_ID}`],
    ['pack', `/lists/${LIST_ID}/pack`],
    ['organize', `/lists/${LIST_ID}/organize`],
  ] as const)('persists %s mode', (mode, expected) => {
    expect(persistedListPath(LIST_ID, mode)).toBe(expected)
  })
})

describe('listDocumentTitle', () => {
  it.each([
    ['edit', 'Weekend Trip - List'],
    ['organize', 'Weekend Trip - Organize'],
    ['pack', 'Weekend Trip - Pack'],
  ] as const)('names the %s browser view', (mode, expected) => {
    expect(listDocumentTitle('Weekend Trip', mode)).toBe(expected)
  })
})
