// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RowMenuItem } from './RowMenuItem'

afterEach(cleanup)

describe('RowMenuItem', () => {
  it('uses a touch target below lg and compacts for pointer layouts', () => {
    render(<RowMenuItem icon={<span />} onClick={vi.fn()}>Duplicate plan</RowMenuItem>)

    expect(screen.getByRole('button', { name: 'Duplicate plan' }).className).toContain(
      'min-h-10 lg:min-h-7',
    )
  })
})
