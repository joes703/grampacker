// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'

import MagicLinkPage from './MagicLinkPage'
import { MAGIC_LINK_PATH } from '../../shared/auth'

const originalLocation = window.location
let assignMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  assignMock = vi.fn()
  // The page only ever reads window.location.assign; a minimal stand-in avoids
  // jsdom's "Not implemented: navigation" noise and lets us assert the target.
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { assign: assignMock },
  })
})

afterEach(() => {
  cleanup()
  Object.defineProperty(window, 'location', { configurable: true, value: originalLocation })
})

// Renders at a real route so useSearchParams and the replace-navigation behave as
// they do in the app.
//
// The URL under MemoryRouter lives in the ROUTER, not in window.location - which
// jsdom leaves at '/' whatever the router does. Asserting the token scrub against
// window.location would pass even with no scrub at all, so the router's current
// URL is surfaced into the DOM and asserted from there.
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
        <Route path="/sign-in" element={<div>sign-in</div>} />
      </Routes>
      <LocationProbe />
    </MemoryRouter>,
  )
}

const signInButton = () => screen.getByRole('button', { name: 'Sign in' })

// The endpoint the click must navigate to, with the redirect targets that make
// better-auth's 302s land somewhere the SPA can handle.
function expectedVerifyUrl(token: string) {
  const query = new URLSearchParams({
    token,
    callbackURL: '/',
    errorCallbackURL: '/sign-in',
  })
  return `/api/auth/magic-link/verify?${query.toString()}`
}

describe('MagicLinkPage', () => {
  it('does NOT verify on load - only on a real click', async () => {
    // The reason this page exists at all. better-auth's verify endpoint is a
    // side-effecting GET that consumes the single-use token, so if the email
    // linked straight at it, a mail scanner or link previewer fetching the URL
    // would burn the token before the human - who is by definition already locked
    // out - ever clicked. Loading THIS page consumes nothing.
    renderAt(`${MAGIC_LINK_PATH}?token=abc123`)

    // Give any stray effect a chance to fire before asserting the negative.
    await waitFor(() => expect(signInButton()).toBeInTheDocument())
    expect(assignMock).not.toHaveBeenCalled()
  })

  it('NAVIGATES to verify on click (never fetches it)', async () => {
    // A fetch would silently FOLLOW better-auth's error 302 to a 200 HTML page and
    // report no error, so a spent or expired link would look like a success: the
    // app would route home with no session and bounce the user back to /sign-in
    // with nothing explaining why. A real navigation lets the 302 do its job -
    // success carries the session cookie to '/', failure lands on
    // /sign-in?error=... which SignInPage renders as a banner.
    renderAt(`${MAGIC_LINK_PATH}?token=abc123`)

    fireEvent.click(signInButton())

    await waitFor(() =>
      expect(assignMock).toHaveBeenCalledWith(expectedVerifyUrl('abc123')),
    )
  })

  it('scrubs the token out of the URL but still holds it for the click', async () => {
    // A session-minting token must not linger in the address bar, in history, or
    // in the Referer of same-origin requests. It is scrubbed on mount - and the
    // click must STILL work afterwards, which is the half that would break if the
    // token were re-read from the URL on each render instead of captured once.
    renderAt(`${MAGIC_LINK_PATH}?token=abc123`)

    await waitFor(() => expect(currentUrl()).toBe(MAGIC_LINK_PATH))
    expect(currentUrl()).not.toContain('abc123')

    fireEvent.click(signInButton())
    await waitFor(() =>
      expect(assignMock).toHaveBeenCalledWith(expectedVerifyUrl('abc123')),
    )
  })

  it('percent-encodes the token rather than splicing it into the URL raw', async () => {
    // The token comes from a URL an attacker can hand the user. Concatenating it
    // unescaped would let '&' or '#' in it forge extra query parameters - notably
    // a callbackURL of the attacker's choosing.
    renderAt(`${MAGIC_LINK_PATH}?token=a%26callbackURL%3Dhttps%3A%2F%2Fevil.test`)

    fireEvent.click(signInButton())

    await waitFor(() => expect(assignMock).toHaveBeenCalledTimes(1))
    const target = assignMock.mock.calls[0]?.[0] as string
    // Exactly one callbackURL, and it is ours.
    expect(target.match(/callbackURL=/g)).toHaveLength(1)
    expect(target).not.toContain('evil.test/')
    expect(new URLSearchParams(target.split('?')[1]).get('callbackURL')).toBe('/')
  })

  it('shows the broken-link card when there is no token at all', () => {
    renderAt(MAGIC_LINK_PATH)
    expect(screen.getByRole('heading', { name: 'Broken link' })).toBeInTheDocument()
    expect(assignMock).not.toHaveBeenCalled()
  })

  it('does not fire a second navigation while one is in flight', async () => {
    // The token is single-use. Two verifies would race, and the loser would report
    // an invalid link to a user who just signed in.
    renderAt(`${MAGIC_LINK_PATH}?token=abc123`)

    // Hold the element: its label flips to "Signing in..." on the first click, so
    // re-querying by name would miss it - and a real double-click hits the same
    // element twice regardless of what it now says.
    const button = signInButton()
    fireEvent.click(button)
    fireEvent.click(button)

    expect(assignMock).toHaveBeenCalledTimes(1)
  })
})
