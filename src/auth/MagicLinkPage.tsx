import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { authClient } from '../lib/auth-client'
import { authErrorMessage } from './auth-errors'
import { AuthCard, ErrorText, PRIMARY_BUTTON, TEXT_LINK } from './auth-ui'

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
  const token = searchParams.get('token')

  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
