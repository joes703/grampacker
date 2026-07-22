import { describe, expect, it } from 'vitest'

describe('owner category footer wiring', () => {
  it('passes canonical base and consumable category totals to categorized and uncategorized sections', () => {
    const sources = import.meta.glob('./ListDetailPage.tsx', {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, string>
    const source = Object.values(sources)[0]!

    expect(source).toContain('baseSubtotalGrams={baseGramsForCategory(weightBreakdown, definition.id)}')
    expect(source).toContain('consumableSubtotalGrams={consumableGramsForCategory(weightBreakdown, definition.id)}')
    expect(source).toContain('baseSubtotalGrams={baseGramsForCategory(weightBreakdown, null)}')
    expect(source).toContain('consumableSubtotalGrams={consumableGramsForCategory(weightBreakdown, null)}')
  })
})
