import { createAuthClient } from 'better-auth/react'

// Same-origin SPA: the client's defaults (window.location.origin, basePath
// /api/auth) match the server mount in server/index.ts, so no config.
// Version-locked to the server by sharing the better-auth package pin.
export const authClient = createAuthClient()
