// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StaticCategorySection } from './CategorySection'

afterEach(() => {
  cleanup()
})

// The rename input commits on blur, and pressing a button moves focus there
// BEFORE its click fires. Unless the Confirm and Cancel buttons keep focus in
// the input, pressing Cancel blurs the input, the blur commits the draft, and
// the buttons unmount before Cancel's click can run.

function renderSection() {
  const onRenameCategory = vi.fn()
  render(
    <StaticCategorySection
      category={{ id: 'cat-1', name: 'Shelter', sortOrder: 0, createdAt: '2026-06-06T00:00:00.000Z' }}
      items={[]}
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
      onRenameCategory={onRenameCategory}
      onDeleteCategory={vi.fn()}
    />,
  )
  return { onRenameCategory }
}

async function startRename(user: ReturnType<typeof userEvent.setup>, draft: string) {
  await user.click(screen.getByTitle('Rename category'))
  const input = screen.getByDisplayValue('Shelter')
  await user.clear(input)
  await user.type(input, draft)
}

describe('gear category rename buttons', () => {
  it('Cancel discards the draft', async () => {
    const user = userEvent.setup()
    const { onRenameCategory } = renderSection()
    await startRename(user, 'Oops')

    await user.click(screen.getByRole('button', { name: 'Cancel rename' }))

    expect(onRenameCategory).not.toHaveBeenCalled()
    expect(screen.getByTitle('Rename category')).toHaveTextContent('Shelter')
  })

  it('Confirm commits the draft exactly once', async () => {
    const user = userEvent.setup()
    const { onRenameCategory } = renderSection()
    await startRename(user, 'Tents')

    await user.click(screen.getByRole('button', { name: 'Confirm rename' }))

    expect(onRenameCategory).toHaveBeenCalledTimes(1)
    expect(onRenameCategory).toHaveBeenCalledWith('cat-1', 'Tents')
  })
})
