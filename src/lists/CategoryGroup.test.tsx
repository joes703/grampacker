// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { ListItemWithGear } from '../lib/types'
import CategoryGroup from './CategoryGroup'

afterEach(() => {
  cleanup()
})

function itemNamed(id: string, name: string): ListItemWithGear {
  return {
    id,
    listId: 'list-1',
    gearItemId: `gear-${id}`,
    quantity: 1,
    isWorn: false,
    isConsumable: false,
    isPacked: false,
    isReady: false,
    sortOrder: 0,
    createdAt: '2026-06-06T00:00:00.000Z',
    updatedAt: '2026-06-06T00:00:00.000Z',
    gearItem: {
      id: `gear-${id}`,
      categoryId: null,
      name,
      description: null,
      weightGrams: 100,
      cost: null,
      purchaseDate: null,
      status: 'active',
      sortOrder: 0,
      createdAt: '2026-06-06T00:00:00.000Z',
      updatedAt: '2026-06-06T00:00:00.000Z',
    },
  }
}

describe('CategoryGroup region id', () => {
  // The Worn pseudo-section (ListDetailPage) renders alongside the real
  // Uncategorized section and passes no categoryId. Both derived their region
  // id from `categoryId ?? 'uncategorized'`, so both emitted
  // id="cat-region-uncategorized" and both collapse chevrons pointed
  // aria-controls at whichever element won. regionKey disambiguates.
  it('gives a categoryId-less section a distinct region id from Uncategorized', () => {
    render(
      <>
        <CategoryGroup
          name="Uncategorized"
          categoryId={null}
          items={[itemNamed('item-1', 'Stove')]}
          weightUnit="g"
        />
        <CategoryGroup
          name="Worn"
          regionKey="worn"
          items={[itemNamed('item-2', 'Sun hat')]}
          weightUnit="g"
        />
      </>,
    )

    const targets = screen
      .getAllByRole('button', { name: /Collapse|Expand/ })
      .map((button) => button.getAttribute('aria-controls'))

    expect(targets).toHaveLength(2)
    expect(new Set(targets).size).toBe(2)
    for (const id of targets) {
      expect(id).not.toBeNull()
      expect(document.querySelectorAll(`#${id}`)).toHaveLength(1)
    }
  })

  // The share view (SharePage) passes collapsible={false} and NO categoryId
  // for every section, so every section - each category plus the trailing
  // Worn group - derived the same 'cat-region-uncategorized' id. Nothing
  // references those ids there, since the chevron that would point at them
  // isn't rendered, so they are emitted only alongside the chevron.
  it('emits no region id when the section is not collapsible', () => {
    const { container } = render(
      <>
        <CategoryGroup
          name="Uncategorized"
          items={[itemNamed('item-1', 'Stove')]}
          weightUnit="g"
          collapsible={false}
        />
        <CategoryGroup
          name="Worn"
          items={[itemNamed('item-2', 'Sun hat')]}
          weightUnit="g"
          collapsible={false}
        />
      </>,
    )

    expect(container.querySelectorAll('[id^="cat-region-"]')).toHaveLength(0)
  })
})
