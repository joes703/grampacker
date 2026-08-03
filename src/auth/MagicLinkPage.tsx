import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { AuthCard, PRIMARY_BUTTON, TEXT_LINK } from './auth-ui'
import { MAGIC_LINK_PATH } from '../../shared/auth'

// The emailed link carries the token in the FRAGMENT (`/auth/magic#token=...`),
// because a browser puts the fragment in neither the request line nor the
// `Referer` header. So the live, unconsumed token stays out of edge/proxy access
// logs and out of the `Referer` of every same-origin request this page makes. It
// does NOT keep the token out of the email itself - the mail provider and any
// receiving gateway still see it. See SECURITY.md.
//
// `?token=` is still read as a fallback. Links already sitting in an inbox when
// this shipped point at the query form, and they stay valid for their 5-minute
// life - dropping them would have signed those people out of the recovery path
// for no gain. Reading a query token leaks nothing that was not already leaked by
// the request that delivered it. Safe to delete once no such link can be live.
function readToken(search: string, hash: string): string | null {
  // URLSearchParams handles the percent-decoding, matching encodeURIComponent on
  // the sending side (server/auth.ts).
  const fragment = new URLSearchParams(hash.replace(/^#/, ''))
  return fragment.get('token') ?? new URLSearchParams(search).get('token')
}

// Where a magic-link email lands (shared/auth.ts MAGIC_LINK_PATH).
//
// The whole point of this page is what it does NOT do: it does not verify on
// load. better-auth's own verify endpoint is a side-effecting GET - it consumes
// the single-use token, creates the user, and mints a session - so linking
// straight at it means any mail scanner or link previewer that fetches the URL
// burns the token before the human ever clicks. The human is, by definition,
// already locked out, and they would get "invalid link" on their first real
// attempt.
//
// So: render a button, verify on a real gesture. A bot that GETs this page
// consumes nothing.
export default function MagicLinkPage() {
  const navigate = useNavigate()
  const { search, hash } = useLocation()

  // Read the token ONCE into state, then scrub it out of the URL below. Captured
  // in a lazy initializer so the value survives the very re-render the scrub
  // causes - reading the location on each render would hand back null after it.
  const [token] = useState(() => readToken(search, hash))

  // No error state: every failure is a 302 the browser follows to
  // /sign-in?error=..., which SignInPage renders. There is nothing left to show
  // here, and keeping a dead error branch would just imply otherwise.
  const [pending, setPending] = useState(false)

  // A session-minting token has no business sitting in the address bar. The
  // fragment keeps it off the wire, but it is still right there in the URL - in
  // browser history, in a screen share, in whatever the user pastes to ask why
  // sign-in is not working. Replace (not push) so Back cannot walk into a URL
  // carrying it either.
  //
  // Scrubs search AND hash: the token can arrive in either (see readToken), and
  // leaving the other one behind would defeat the point. Navigating to the bare
  // path empties both, so this cannot re-trigger itself.
  useEffect(() => {
    if (search !== '' || hash !== '') {
      void navigate(MAGIC_LINK_PATH, { replace: true })
    }
  }, [search, hash, navigate])

  // A real browser NAVIGATION, not a fetch. That is a correctness requirement,
  // not a style choice.
  //
  // better-auth's verify endpoint answers with a 302 on EVERY failure path
  // (invalid, reused, expired -> `throw ctx.redirect(errorCallbackURL)`), and it
  // only returns JSON on success when no callbackURL is given. Calling it with
  // fetch means fetch silently FOLLOWS that redirect, lands on a 200 HTML page,
  // and hands back no error at all - so the client concludes the sign-in worked,
  // navigates home with no session, and the user is bounced back to /sign-in with
  // nothing explaining why. The most common failure in the whole app (a link that
  // was already used, or is more than 5 minutes old) would be a silent loop.
  //
  // Navigating lets the redirect do its job: on success the 302 carries the
  // session cookie and lands on '/', and on failure it lands on
  // /sign-in?error=... which SignInPage already renders as a banner.
  //
  // Scanner safety is unaffected: this runs on a CLICK. The emailed URL still
  // points at this page, which has no side effects on load.
  function handleVerify() {
    if (pending || !token) return
    setPending(true)
    // No last-list-pointer bookkeeping here. Redeeming a link (re)establishes a
    // session in a BRAND-NEW document that lands on '/', and if this browser was
    // signed in as A while this link is for B, A's pointer survives in
    // localStorage across the navigation. That is closed at the READ instead:
    // the pointer is owner-tagged and RootRedirect only follows one the current
    // account wrote (see lib/last-list-path.ts), so a fresh document as B never
    // routes into A's list URL - and A keeps its own shortcut. Clearing here
    // would only wipe a returning A's valid pointer for no gain.
    const query = new URLSearchParams({
      token,
      callbackURL: '/',
      errorCallbackURL: '/sign-in',
    })
    window.location.assign(`/api/auth/magic-link/verify?${query.toString()}`)
  }

  if (!token) {
    return (
      <AuthCard title="Broken link">
        <p className="text-sm text-gray-700">
          That link is missing its token. Request a new one.
        </p>
        <p className="mt-4 text-sm text-gray-600">
          <button type="button" className={TEXT_LINK} onClick={() => void navigate('/sign-in')}>
            Back to sign in
          </button>
        </p>
      </AuthCard>
    )
  }

  return (
    <AuthCard title="Sign in to grampacker">
      <p className="text-sm text-gray-700">
        Confirm it is you to finish signing in on this device.
      </p>
      <div className="mt-4 space-y-3">
        <button
          type="button"
          className={PRIMARY_BUTTON}
          onClick={handleVerify}
          disabled={pending}
        >
          {pending ? 'Signing in...' : 'Sign in'}
        </button>
        <p className="text-sm text-gray-600">
          <button type="button" className={TEXT_LINK} onClick={() => void navigate('/sign-in')}>
            Request a new link
          </button>
        </p>
      </div>
    </AuthCard>
  )
}
