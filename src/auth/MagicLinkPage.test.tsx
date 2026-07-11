// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'

const h = vi.hoisted(() => ({
  verify: vi.fn<(input: { query: { token: string } }) => Promise<{ error: unknown }>>(),
}))

vi.mock('../lib/auth-client', () => ({
  authClient: { magicLink: { verify: h.verify } },
}))

import MagicLinkPage from './MagicLinkPage'
import { MAGIC_LINK_PATH } from '../../shared/auth'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

// Renders the page at a real route so useSearchParams and the replace-navigation
// behave as they do in the app. The sibling routes exist so a successful verify
// (which navigates to '/') has somewhere to land and can be asserted on.
//
// The URL under MemoryRouter lives in the ROUTER, not in window.location - which
// jsdom leaves at '/' no matter what the router does. Asserting the scrub against
// window.location would therefore pass without the scrub existing at all, so the
// current router URL is surfaced into the DOM and asserted from there.
function LocationProbe() {
  const { pathname, search } = useLocation()
  return <div data-testid="location">{`${pathname}${search}`}</div>
}

const currentUrl = () => screen.getByTestId('location').textContent

function renderAt(url: string) {
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path={MAGIC_LINK_PATH} element={<MagicLinkPage />} />
        <Route path="/" element={<div>home</div>} />
        <Route path="/sign-in" element={<div>sign-in</div>} />
      </Routes>
      <LocationProbe />
    </MemoryRouter>,
  )
}

const signInButton = () => screen.getByRole('button', { name: 'Sign in' })

describe('MagicLinkPage token handling', () => {
  it('does NOT verify on load - only on a real click', async () => {
    // The reason this page exists. better-auth's verify endpoint is a
    // side-effecting GET that consumes the single-use token, so if the email
    // linked straight at it, a mail scanner or link previewer fetching the URL
    // would burn the token before the human - who is by definition already
    // locked out - ever clicked. A bot that loads THIS page consumes nothing.
    renderAt(`${MAGIC_LINK_PATH}?token=abc123`)

    // Give any stray effect a chance to fire before asserting the negative.
    await waitFor(() => expect(signInButton()).toBeInTheDocument())
    expect(h.verify).not.toHaveBeenCalled()
  })

  it('verifies with the token from the URL when clicked, then goes home', async () => {
    h.verify.mockResolvedValue({ error: null })
    renderAt(`${MAGIC_LINK_PATH}?token=abc123`)

    fireEvent.click(signInButton())

    await waitFor(() =>
      expect(h.verify).toHaveBeenCalledWith({ query: { token: 'abc123' } }),
    )
    expect(await screen.findByText('home')).toBeInTheDocument()
  })

  it('scrubs the token out of the URL but still holds it for the click', async () => {
    // A session-minting token must not linger in the address bar, in history, or
    // in the Referer of same-origin requests. It is scrubbed on mount - and the
    // click must STILL work afterwards, which is the part that would break if the
    // token were re-read from the URL on every render instead of captured once.
    h.verify.mockResolvedValue({ error: null })
    renderAt(`${MAGIC_LINK_PATH}?token=abc123`)

    // The token was in the URL on arrival...
    expect(h.verify).not.toHaveBeenCalled()
    // ...and is gone from it once the scrub lands (a replace-navigation).
    await waitFor(() => expect(currentUrl()).toBe(MAGIC_LINK_PATH))
    expect(currentUrl()).not.toContain('abc123')

    // And the click STILL works: the token is held in state, not re-read from a
    // URL that no longer has it. This is the half that would silently break.
    fireEvent.click(signInButton())
    await waitFor(() =>
      expect(h.verify).toHaveBeenCalledWith({ query: { token: 'abc123' } }),
    )
  })

  it('shows the broken-link card when there is no token at all', () => {
    renderAt(MAGIC_LINK_PATH)
    expect(screen.getByRole('heading', { name: 'Broken link' })).toBeInTheDocument()
    expect(h.verify).not.toHaveBeenCalled()
  })

  it('reports a spent or expired link without pretending it worked', async () => {
    // Single-use and 5 minutes. This is the common case for a link that was
    // clicked twice, or clicked late - the user must be told to get a new one
    // rather than being dropped on a page that looks signed-in but is not.
    h.verify.mockResolvedValue({ error: { status: 400, code: 'INVALID_TOKEN' } })
    renderAt(`${MAGIC_LINK_PATH}?token=spent`)

    fireEvent.click(signInButton())

    expect(await screen.findByText(/invalid, already used, or expired/i)).toBeInTheDocument()
    expect(screen.queryByText('home')).not.toBeInTheDocument()
  })

  it('does not fire a second verify while one is in flight', async () => {
    // The token is single-use: a double-click that sent two verifies would race,
    // and the loser would report "invalid link" to a user who just signed in.
    let resolve: (v: { error: unknown }) => void = () => {}
    h.verify.mockReturnValue(
      new Promise<{ error: unknown }>((r) => {
        resolve = r
      }),
    )
    renderAt(`${MAGIC_LINK_PATH}?token=abc123`)

    // Hold the element: its label flips to "Signing in..." on the first click, so
    // re-querying by name would miss it - and a real double-click hits the same
    // element twice regardless of what it now says.
    const button = signInButton()
    fireEvent.click(button)
    fireEvent.click(button)

    expect(h.verify).toHaveBeenCalledTimes(1)
    resolve({ error: null })
    expect(await screen.findByText('home')).toBeInTheDocument()
  })
})
