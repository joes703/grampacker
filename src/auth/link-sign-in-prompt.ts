import { authClient, passkeysSupported } from '../lib/auth-client'

// Decides whether to offer a passkey after a sign-in by link (PasskeyPrompt).
//
// The verify step is a full-page navigation, so no React state survives it.
// Before navigating, MagicLinkPage notes in sessionStorage (per tab, and it
// survives same-tab navigation) which session was active: its id, or NONE.
// The signed-in app then compares that with the session it has. A successful
// verify always creates a new session, so a different id means the link
// worked. A failed verify leaves the session alone:
// - signed out: the tab lands on /sign-in, and SignInPage forgets the note;
// - signed in: /sign-in redirects back to '/', SignInPage may never mount,
//   and the unchanged id is what stops the prompt.
//
// The stored id is the session's row id, not its token. It cannot sign
// anyone in.
//
// Both storages can throw (blocked site data). Every failure means "no
// prompt": sign-in must never depend on this.
//
// The privacy page (src/site/PrivacyPage.tsx) lists both keys.
const LINK_SIGN_IN = 'gp:link-sign-in'
const PROMPT_SHOWN = 'gp:passkey-prompt-shown'
const NONE = 'none'
// The sign-in waits for this check, so a check that does not answer is
// abandoned. A healthy one takes well under a second.
const SESSION_CHECK_MS = 3000

// `leave` aborts when the caller's page goes away. An aborted check writes
// nothing: the page the person went to may already have forgotten the note
// (SignInPage), and a late write would bring it back.
export async function noteLinkSignInStart(leave: AbortSignal): Promise<void> {
  try {
    const signal = AbortSignal.any([leave, timeoutSignal(SESSION_CHECK_MS)])
    const { data, error } = await authClient.getSession({ fetchOptions: { signal } })
    if (error || signal.aborted) return
    sessionStorage.setItem(LINK_SIGN_IN, data?.session.id ?? NONE)
  } catch {
    // No note, so no prompt. The sign-in itself goes ahead.
  }
}

// Not AbortSignal.timeout: test fake timers cannot advance it.
function timeoutSignal(ms: number): AbortSignal {
  const controller = new AbortController()
  setTimeout(() => controller.abort(), ms)
  return controller.signal
}

export function forgetLinkSignIn(): void {
  try {
    sessionStorage.removeItem(LINK_SIGN_IN)
  } catch {
    // Nothing stored, or nothing readable: either way, no prompt.
  }
}

// The session the prompt is open for, kept for the life of this page.
//
// The check below uses up the note, but React may run the caller's state
// initializer more than once: a render can be thrown away before it commits
// (a suspended lazy chunk, StrictMode) and the next one starts fresh. Without
// this, the first run would use the note and the run that commits would find
// none, and the prompt would never open. Seen in a real browser.
let openFor: string | null = null

// Uses the note up, so a reload cannot offer the passkey a second time. A
// true result also marks this browser as asked, so call it only when the
// prompt will open, and call passkeyOfferClosed when it closes.
export function shouldOfferPasskey(currentSessionId: string): boolean {
  if (openFor === currentSessionId) return true
  let before: string | null
  try {
    before = sessionStorage.getItem(LINK_SIGN_IN)
    sessionStorage.removeItem(LINK_SIGN_IN)
  } catch {
    return false
  }
  if (before === null || before === currentSessionId) return false
  if (!passkeysSupported()) return false
  try {
    if (localStorage.getItem(PROMPT_SHOWN) === '1') return false
    localStorage.setItem(PROMPT_SHOWN, '1')
  } catch {
    return false
  }
  openFor = currentSessionId
  return true
}

export function passkeyOfferClosed(): void {
  openFor = null
}
