import { createAuthClient } from 'better-auth/react'
import { magicLinkClient } from 'better-auth/client/plugins'
import { passkeyClient } from '@better-auth/passkey/client'

// Same-origin SPA: the client's defaults (window.location.origin, basePath
// /api/auth) match the server mount in server/index.ts, so no config
// beyond the plugin list. Version-locked to the server by sharing the
// better-auth package pins.
//
// The plugin list must mirror the SERVER's (server/auth.ts). These client
// plugins are pure type/route shims - they add authClient.signIn.magicLink,
// authClient.magicLink.verify and authClient.signIn.passkey - so a mismatch
// shows up as a missing method, not a runtime security problem.
export const authClient = createAuthClient({
  plugins: [magicLinkClient(), passkeyClient()],
})

// WebAuthn support gate for passkey UI (false in ancient browsers and
// some webviews; true everywhere we care about).
export function passkeysSupported(): boolean {
  return typeof window !== 'undefined' && 'PublicKeyCredential' in window
}
