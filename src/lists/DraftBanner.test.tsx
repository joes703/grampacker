// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import DraftBanner from './DraftBanner'

afterEach(() => {
  cleanup()
})

describe('DraftBanner', () => {
  it('renders the work-in-progress heading and the expect-gaps copy', () => {
    render(<DraftBanner />)
    expect(screen.getByText('Work in progress')).toBeTruthy()
    expect(
      screen.getByText('This list is still being built and may be incomplete.'),
    ).toBeTruthy()
  })
})
