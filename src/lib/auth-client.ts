import { createAuthClient } from 'better-auth/react'
import { passkeyClient } from '@better-auth/passkey/client'

// Same-origin SPA: the client's defaults (window.location.origin, basePath
// /api/auth) match the server mount in server/index.ts, so no config
// beyond the plugin list. Version-locked to the server by sharing the
// better-auth package pins.
export const authClient = createAuthClient({
  plugins: [passkeyClient()],
})

// WebAuthn support gate for passkey UI (false in ancient browsers and
// some webviews; true everywhere we care about).
export function passkeysSupported(): boolean {
  return typeof window !== 'undefined' && 'PublicKeyCredential' in window
}
