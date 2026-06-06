// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import BulkActionsToolbar from './BulkActionsToolbar'
import { LIST_ITEM_CAP } from '../lib/caps'

afterEach(() => {
  cleanup()
})

const noop = () => {}

function renderToolbar(selectedCount: number) {
  return render(
    <BulkActionsToolbar
      selectedCount={selectedCount}
      selectableTotal={selectedCount + 10}
      onClose={noop}
      onSelectAll={noop}
      onDeselectAll={noop}
      onCreateList={noop}
      onMoveToCategory={noop}
      onDelete={noop}
    />,
  )
}

describe('BulkActionsToolbar over-cap warning', () => {
  it('does not warn at exactly LIST_ITEM_CAP', () => {
    renderToolbar(LIST_ITEM_CAP)
    expect(screen.queryByText(new RegExp(`max ${LIST_ITEM_CAP} per list`))).toBeNull()
    // Create list stays enabled at the cap.
    expect(screen.getByRole('button', { name: /Create list/ }).hasAttribute('disabled')).toBe(false)
  })

  it('warns and disables Create list one over LIST_ITEM_CAP', () => {
    renderToolbar(LIST_ITEM_CAP + 1)
    expect(screen.getByText(new RegExp(`max ${LIST_ITEM_CAP} per list`))).toBeTruthy()
    expect(screen.getByRole('button', { name: /Create list/ }).hasAttribute('disabled')).toBe(true)
  })
})
