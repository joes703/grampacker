import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { authClient } from '../lib/auth-client'
import { authErrorMessage } from './auth-errors'
import { AuthCard, ErrorText, PRIMARY_BUTTON, TEXT_LINK } from './auth-ui'
import { MAGIC_LINK_PATH } from '../../shared/auth'

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
  const [searchParams] = useSearchParams()

  // Read the token ONCE into state, then scrub it out of the URL below. Captured
  // in a lazy initializer so the value survives the very re-render the scrub
  // causes - reading searchParams on each render would hand back null after it.
  const [token] = useState(() => searchParams.get('token'))

  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // A session-minting token has no business sitting in the address bar. Left
  // there it lands in browser history, in a screen share, and - because
  // Referrer-Policy still sends a FULL referrer same-origin - in the Referer of
  // every subsequent same-origin request the page makes. Replace (not push) so
  // Back does not walk into a URL carrying it either.
  //
  // This narrows the exposure; it does not erase it. The initial GET of this
  // page still carried the token, so it can exist in edge access logs, which is
  // why the token is also single-use and expires in 5 minutes.
  useEffect(() => {
    if (searchParams.has('token')) {
      void navigate(MAGIC_LINK_PATH, { replace: true })
    }
  }, [searchParams, navigate])

  async function handleVerify() {
    if (pending || !token) return
    setPending(true)
    setError(null)
    try {
      const { error: verifyError } = await authClient.magicLink.verify({
        query: { token },
      })
      if (verifyError) {
        setError(
          authErrorMessage(
            verifyError,
            'That link is invalid, already used, or expired. Request a new one.',
          ),
        )
        return
      }
      void navigate('/')
    } catch {
      setError('That link is invalid, already used, or expired. Request a new one.')
    } finally {
      setPending(false)
    }
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
        <ErrorText message={error} />
        <button
          type="button"
          className={PRIMARY_BUTTON}
          onClick={() => void handleVerify()}
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
