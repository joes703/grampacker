// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'

// better-auth's client RETURNS most failures as { error } instead of
// throwing. A page that only caught exceptions would treat a refused send
// as sent and tell the user to check an inbox that will get nothing, or
// treat a refused passkey as a sign-in. These tests answer the client calls
// and check what the page shows.

const auth = vi.hoisted(() => ({
  magicLink: vi.fn(),
  passkey: vi.fn(),
}))

vi.mock('../lib/auth-client', () => ({
  authClient: { signIn: { magicLink: auth.magicLink, passkey: auth.passkey } },
  passkeysSupported: () => true,
}))

import SignInPage from './SignInPage'

const SENT = 'Check your email'
const BAD_LINK = 'That sign-in link is invalid, already used, or expired. Request a new one.'

function renderAt(url: string) {
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/sign-in" element={<SignInPage />} />
        <Route path="/" element={<div>home page</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

async function requestLink() {
  const user = userEvent.setup()
  await user.type(screen.getByLabelText('Email'), 'hiker@example.com')
  await user.click(screen.getByRole('button', { name: 'Email me a sign-in link' }))
}

beforeEach(() => {
  auth.magicLink.mockResolvedValue({ data: { status: true }, error: null })
  auth.passkey.mockResolvedValue({ data: {}, error: null })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('SignInPage', () => {
  it('explains a failed magic link when it bounces back with ?error=', () => {
    renderAt('/sign-in?error=INVALID_TOKEN')
    expect(screen.getByText(BAD_LINK)).toBeInTheDocument()
  })

  it('shows no failed-link banner on a plain visit', () => {
    renderAt('/sign-in')
    expect(screen.queryByText(BAD_LINK)).not.toBeInTheDocument()
  })

  // The control for the error rows below: a send the client accepts is the
  // only one that may say the link is on its way.
  it('says the link is on its way when the send succeeds', async () => {
    renderAt('/sign-in')
    await requestLink()
    expect(await screen.findByText(SENT)).toBeInTheDocument()
    expect(auth.magicLink).toHaveBeenCalledWith({ email: 'hiker@example.com' })
  })

  it.each([
    {
      name: 'a returned rate limit',
      answer: () => Promise.resolve({ data: null, error: { status: 429 } }),
      copy: 'Too many attempts. Please wait a bit and try again.',
    },
    {
      name: "a returned error with the server's message",
      answer: () => Promise.resolve({ data: null, error: { status: 400, message: 'Invalid email' } }),
      copy: 'Invalid email',
    },
    {
      name: 'a returned error with no message',
      answer: () => Promise.resolve({ data: null, error: { status: 500 } }),
      copy: "Couldn't send the link. Please try again.",
    },
    {
      name: 'a thrown request',
      answer: () => Promise.reject(new Error('offline')),
      copy: "Couldn't send the link. Please try again.",
    },
  ])('shows the error, not "check your email", for $name', async ({ answer, copy }) => {
    auth.magicLink.mockImplementationOnce(answer)
    renderAt('/sign-in')
    await requestLink()

    expect(await screen.findByText(copy)).toBeInTheDocument()
    expect(screen.queryByText(SENT)).not.toBeInTheDocument()
  })

  it('stays on the page with the error when the passkey sign-in returns one', async () => {
    auth.passkey.mockResolvedValueOnce({ data: null, error: { status: 401, message: 'Passkey not found' } })
    renderAt('/sign-in')
    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign in with a passkey' }))

    expect(await screen.findByText('Passkey not found')).toBeInTheDocument()
    expect(screen.queryByText('home page')).not.toBeInTheDocument()
  })
})
