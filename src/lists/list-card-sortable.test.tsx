// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { useListCardSortable } from './list-card-sortable'

afterEach(cleanup)

function Harness() {
  const { dragHandle } = useListCardSortable({
    listId: 'list-1',
    listName: 'Weekend trip',
  })
  return <div>{dragHandle}</div>
}

describe('list-card reorder activator', () => {
  it('is focusable and names the list it reorders', () => {
    render(<Harness />)

    expect(screen.getByRole('button', { name: 'Reorder Weekend trip' })).toHaveAttribute(
      'tabindex',
      '0',
    )
  })
})
