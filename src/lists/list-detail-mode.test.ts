import { describe, expect, it } from 'vitest'
import {
  deriveListMode,
  persistedListPath,
  toggledListModePath,
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

describe('toggledListModePath', () => {
  it.each([
    ['edit', 'pack', `/lists/${LIST_ID}/pack`],
    ['pack', 'pack', `/lists/${LIST_ID}`],
    ['organize', 'pack', `/lists/${LIST_ID}/pack`],
    ['edit', 'organize', `/lists/${LIST_ID}/organize`],
    ['organize', 'organize', `/lists/${LIST_ID}`],
    ['pack', 'organize', `/lists/${LIST_ID}/organize`],
  ] as const)('toggles %s -> %s to %s', (current, target, expected) => {
    expect(toggledListModePath(LIST_ID, current, target)).toBe(expected)
  })
})
