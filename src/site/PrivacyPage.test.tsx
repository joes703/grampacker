// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import PrivacyPage from './PrivacyPage'

afterEach(cleanup)

describe('PrivacyPage', () => {
  // Renders with no session and no query client: the route is public, and a
  // signed-out visitor reaches it from the sign-in page footer.
  it('renders without a session and gives the contact address', () => {
    render(
      <MemoryRouter>
        <PrivacyPage />
      </MemoryRouter>,
    )
    expect(screen.getByRole('heading', { name: 'Privacy', level: 1 })).toBeInTheDocument()
    expect(document.title).toBe('Privacy · grampacker')
    const article = screen.getByRole('article')
    expect(within(article).getByRole('link', { name: 'hello@grampacker.app' })).toHaveAttribute(
      'href',
      'mailto:hello@grampacker.app',
    )
  })
})
