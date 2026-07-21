import { describe, expect, it } from 'vitest'
import { deriveListMode, persistedListPath } from './list-detail-mode'

const LIST_ID = 'list-1'

describe('deriveListMode', () => {
  it.each([
    [`/lists/${LIST_ID}`, '', 'edit'],
    [`/lists/${LIST_ID}/pack`, '', 'pack'],
    [`/lists/${LIST_ID}/pack/organize`, '', 'organize'],
    [`/lists/${LIST_ID}`, '?mode=pack', 'pack'],
    [`/lists/${LIST_ID}`, '?mode=PACK', 'edit'],
  ] as const)('%s%s -> %s', (pathname, search, expected) => {
    expect(deriveListMode(pathname, search, LIST_ID)).toBe(expected)
  })
})

describe('persistedListPath', () => {
  it('persists Organize as the pack checklist, not the transient editor route', () => {
    expect(persistedListPath(LIST_ID, 'organize')).toBe(`/lists/${LIST_ID}/pack`)
  })

  it.each([
    ['edit', `/lists/${LIST_ID}`],
    ['pack', `/lists/${LIST_ID}/pack`],
  ] as const)('persists %s mode', (mode, expected) => {
    expect(persistedListPath(LIST_ID, mode)).toBe(expected)
  })
})
