// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  getSession: vi.fn<() => Promise<{ data: unknown; error: unknown }>>(),
}))

vi.mock('../lib/auth-client', () => ({
  authClient: { getSession: h.getSession },
  passkeysSupported: () => 'PublicKeyCredential' in window,
}))

import {
  forgetLinkSignIn,
  noteLinkSignInStart,
  passkeyOfferClosed,
  shouldOfferPasskey,
} from './link-sign-in-prompt'

function withPasskeys(supported: boolean) {
  if (supported) {
    Object.defineProperty(window, 'PublicKeyCredential', { configurable: true, value: function () {} })
  } else {
    Reflect.deleteProperty(window, 'PublicKeyCredential')
  }
}

beforeEach(() => withPasskeys(true))

afterEach(() => {
  passkeyOfferClosed()
  sessionStorage.clear()
  localStorage.clear()
  withPasskeys(false)
  vi.restoreAllMocks()
  h.getSession.mockReset()
})

describe('a sign-in by link, then the signed-in app', () => {
  it('offers a passkey when a new session replaced a signed-out tab', async () => {
    h.getSession.mockResolvedValue({ data: null, error: null })
    await noteLinkSignInStart()

    expect(shouldOfferPasskey('session-new')).toBe(true)
  })

  it('offers a passkey when the link replaced another session', async () => {
    h.getSession.mockResolvedValue({ data: { session: { id: 'session-a' } }, error: null })
    await noteLinkSignInStart()

    expect(shouldOfferPasskey('session-b')).toBe(true)
  })

  it('does not offer one when the link failed and the old session is still here', async () => {
    // Signed in as A, the link fails: better-auth sends the tab to /sign-in,
    // which redirects A back to '/'. The session did not change, so no link
    // sign-in finished.
    h.getSession.mockResolvedValue({ data: { session: { id: 'session-a' } }, error: null })
    await noteLinkSignInStart()
    expect(shouldOfferPasskey('session-a')).toBe(false)

    // Positive control: the same note, with a new session, does offer it.
    await noteLinkSignInStart()
    expect(shouldOfferPasskey('session-b')).toBe(true)
  })

  it('does not offer one without a link sign-in in this tab', () => {
    expect(shouldOfferPasskey('session-new')).toBe(false)
  })

  it('does not offer one when the sign-in page cleared the note', async () => {
    h.getSession.mockResolvedValue({ data: null, error: null })
    await noteLinkSignInStart()
    forgetLinkSignIn()

    expect(shouldOfferPasskey('session-new')).toBe(false)
  })

  it('writes no note when the session check fails', async () => {
    h.getSession.mockResolvedValue({ data: null, error: { status: 500 } })
    await noteLinkSignInStart()
    expect(shouldOfferPasskey('session-new')).toBe(false)

    h.getSession.mockRejectedValue(new Error('offline'))
    await expect(noteLinkSignInStart()).resolves.toBeUndefined()
    expect(shouldOfferPasskey('session-new')).toBe(false)
  })

  it('keeps offering until the prompt closes, for renders React throws away', async () => {
    // A state initializer can run again after an uncommitted render. The
    // second run must give the same answer, or the prompt never opens.
    h.getSession.mockResolvedValue({ data: null, error: null })
    await noteLinkSignInStart()

    expect(shouldOfferPasskey('session-new')).toBe(true)
    expect(shouldOfferPasskey('session-new')).toBe(true)

    passkeyOfferClosed()
    expect(shouldOfferPasskey('session-new')).toBe(false)
  })

  it('offers it once per browser, even after a later link sign-in', async () => {
    h.getSession.mockResolvedValue({ data: null, error: null })
    await noteLinkSignInStart()
    expect(shouldOfferPasskey('session-1')).toBe(true)
    passkeyOfferClosed()

    await noteLinkSignInStart()
    expect(shouldOfferPasskey('session-2')).toBe(false)
  })

  it('does not offer one in a browser without passkey support', async () => {
    withPasskeys(false)
    h.getSession.mockResolvedValue({ data: null, error: null })
    await noteLinkSignInStart()

    expect(shouldOfferPasskey('session-new')).toBe(false)
  })

  it('does not offer one when browser storage throws', async () => {
    h.getSession.mockResolvedValue({ data: null, error: null })
    await noteLinkSignInStart()
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })

    expect(shouldOfferPasskey('session-new')).toBe(false)
  })
})
