// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { GearItem } from '../lib/types'
import { SortableCategorySection, StaticCategorySection } from './CategorySection'

afterEach(() => {
  cleanup()
})

// Guards the horizontal alignment contract in docs/ui-density.md "Reserved
// space": a leading header control may occupy a row-control slot only when the
// rows reserve an equivalent slot.
//
// The gear category header previously led with BOTH a category drag handle and
// the collapse chevron, while each GearItemRow leads with a single drag
// handle. That extra leading control pushed the category title 30px right of
// the item names beneath it (measured in a browser at 1280px). The chevron is
// the control that mirrors the row's slot, so it must lead; the section-only
// grip belongs after the title.
//
// jsdom has no layout engine, so this cannot assert pixel positions - the real
// alignment was verified in a browser. What it CAN pin is the DOM order that
// produces it, which is what a future edit would silently break.

const item: GearItem = {
  id: 'gear-1',
  categoryId: 'cat-1',
  name: 'Tarp',
  description: null,
  weightGrams: 250.5,
  cost: null,
  purchaseDate: null,
  status: 'active',
  sortOrder: 0,
  createdAt: '2026-06-06T00:00:00.000Z',
  updatedAt: '2026-06-06T00:00:00.000Z',
}

function renderSection() {
  return render(
    <SortableCategorySection
      id="cat-1"
      category={{ id: 'cat-1', name: 'Shelter', sortOrder: 0, createdAt: '2026-06-06T00:00:00.000Z' }}
      items={[item]}
      weightUnit="g"
      isBelowLg={false}
      collapsed={false}
      onToggleCollapse={vi.fn()}
      selectMode={false}
      selectedIds={new Set()}
      onToggleSelect={vi.fn()}
      onInlineSave={vi.fn()}
      onEditItem={vi.fn()}
      onDeleteItem={vi.fn()}
      onSetItemStatus={vi.fn()}
      onRenameCategory={vi.fn()}
      onDeleteCategory={vi.fn()}
    />,
  )
}

describe('gear category header alignment contract', () => {
  it('leads the header with the chevron, not the category grip', () => {
    renderSection()
    const chevron = screen.getByRole('button', { name: /Collapse Shelter/ })
    const header = chevron.closest('div')!
    const controls = [...header.querySelectorAll('button')]
    // The chevron must be the first control in the header. If a future edit
    // reintroduces a leading grip (or any other control), this fails.
    expect(controls[0]).toBe(chevron)
  })

  it('places the category grip after the title', () => {
    renderSection()
    const chevron = screen.getByRole('button', { name: /Collapse Shelter/ })
    const header = chevron.closest('div')!
    const grip = [...header.querySelectorAll('button')]
      .find((b) => b.getAttribute('aria-label') === 'Reorder Shelter')
    expect(grip).toBeDefined()
    expect(grip).toHaveAttribute('tabindex', '0')

    const title = header.querySelector('button[title="Rename category"]')!
    expect(title).not.toBeNull()
    // DOCUMENT_POSITION_FOLLOWING === the grip comes after the title.
    expect(title.compareDocumentPosition(grip!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('keeps the grip OUT of the trailing column rail', () => {
    renderSection()
    const chevron = screen.getByRole('button', { name: /Collapse Shelter/ })
    const header = chevron.closest('div')!
    const kebab = [...header.querySelectorAll('button')]
      .find((b) => /Category options/i.test(b.getAttribute('aria-label') ?? ''))!
    const grip = [...header.querySelectorAll('button')]
      .find((b) => b.getAttribute('aria-label') === 'Reorder Shelter')!

    // The rail is the ml-auto cluster holding the width-matched
    // Price/Purchased/Weight labels and the kebab. Putting the grip anywhere
    // inside it - including immediately before the kebab, which "grip after
    // title" and "kebab last" both still permit - shifts every label off its
    // row column. This is the assertion that actually pins the fix.
    const rail = kebab.closest('div[class*="ml-auto"]')
    expect(rail).not.toBeNull()
    expect(rail!.contains(grip)).toBe(false)

    // And nothing at all may follow the rail, element or not.
    expect(rail!.nextElementSibling).toBeNull()
  })

  it('renders no grip and no leading placeholder for Uncategorized', () => {
    render(
      <StaticCategorySection
        category={null}
        items={[{ ...item, categoryId: null }]}
        weightUnit="g"
        isBelowLg={false}
        collapsed={false}
        onToggleCollapse={vi.fn()}
        selectMode={false}
        selectedIds={new Set()}
        onToggleSelect={vi.fn()}
        onInlineSave={vi.fn()}
        onEditItem={vi.fn()}
        onDeleteItem={vi.fn()}
        onSetItemStatus={vi.fn()}
        onRenameCategory={vi.fn()}
        onDeleteCategory={vi.fn()}
      />,
    )
    const chevron = screen.getByRole('button', { name: /Collapse Uncategorized/ })
    const header = chevron.closest('div')!
    // Uncategorized cannot be reordered, so it has no grip. It also must NOT
    // carry a leading spacer standing in for one: the chevron leads both
    // variants now, which is what keeps their titles on the same column.
    expect(
      [...header.querySelectorAll('button')]
        .find((b) => b.getAttribute('aria-label')?.startsWith('Reorder ')),
    ).toBeUndefined()
    expect([...header.querySelectorAll('button')][0]).toBe(chevron)
  })
})

// The "(N)" membership count was removed from the gear category header. The
// rows are right there to be counted, and the number added noise to every
// header. There are TWO header variants and the count lived in both, so a
// partial restoration is the realistic regression: pin them separately.
describe('gear category header carries no membership count', () => {
  it('renders no count in the renameable variant', () => {
    renderSection()
    const chevron = screen.getByRole('button', { name: /Collapse Shelter/ })
    const header = chevron.closest('div')!
    expect(header.textContent).not.toMatch(/\d/)
  })

  it('renders no count in the static variant', () => {
    render(
      <StaticCategorySection
        category={null}
        items={[{ ...item, categoryId: null }]}
        weightUnit="g"
        isBelowLg={false}
        collapsed={false}
        onToggleCollapse={vi.fn()}
        selectMode={false}
        selectedIds={new Set()}
        onToggleSelect={vi.fn()}
        onInlineSave={vi.fn()}
        onEditItem={vi.fn()}
        onDeleteItem={vi.fn()}
        onSetItemStatus={vi.fn()}
        onRenameCategory={vi.fn()}
        onDeleteCategory={vi.fn()}
      />,
    )
    const chevron = screen.getByRole('button', { name: /Collapse Uncategorized/ })
    const header = chevron.closest('div')!
    expect(header.textContent).not.toMatch(/\d/)
  })
})
