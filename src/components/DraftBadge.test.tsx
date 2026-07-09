// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import DraftBadge from './DraftBadge'

afterEach(() => {
  cleanup()
})

describe('DraftBadge', () => {
  it('renders the Draft label', () => {
    render(<DraftBadge />)
    expect(screen.getByText('Draft')).toBeTruthy()
  })

  it('merges a passed className', () => {
    render(<DraftBadge className="ml-2" />)
    expect(screen.getByText('Draft').className).toContain('ml-2')
  })
})
