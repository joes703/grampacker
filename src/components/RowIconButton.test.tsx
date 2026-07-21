// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import RowIconButton from './RowIconButton'

afterEach(cleanup)

describe('RowIconButton', () => {
  it('uses the responsive row-control target when it can render below lg', () => {
    render(<RowIconButton icon={<span />} ariaLabel="Move item" touchSafe />)

    expect(screen.getByRole('button', { name: 'Move item' }).className).toContain(
      'h-10 w-10 lg:h-7 lg:w-7',
    )
  })

  it('keeps the compact target for desktop-only row controls', () => {
    render(<RowIconButton icon={<span />} ariaLabel="Edit item" />)

    expect(screen.getByRole('button', { name: 'Edit item' }).className).toContain('w-7 h-6')
  })
})
