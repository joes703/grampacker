import { z } from 'zod'

// DTO contract for /api/me. The response schema is the allowlist: fields
// not named here never leave the server, and the SPA validates against it.
// No `name`: grampacker never collects or stores a display name
// (data-minimization call, 2026-07-09). The former PUT /api/me existed only
// to update the name, so the route is GET-only now; its cross-cutting CSRF
// coverage moved to server/middleware/csrf.test.ts.
export const meResponseSchema = z.object({
  id: z.string(),
  email: z.string(),
  emailVerified: z.boolean(),
  createdAt: z.string(), // ISO timestamp
})

export type MeResponse = z.infer<typeof meResponseSchema>

// POST /api/me/reauth - exchange the account password for a short-lived
// fresh-auth proof ("sudo mode"), which passkey mutations require.
//
// Deliberately NOT reusing the sign-up password rules (MIN_PASSWORD_LENGTH):
// this verifies an EXISTING password, and applying today's length floor to it
// would reject users whose password predates the floor - a confusing failure
// that looks like a wrong password. Length is the server's business at
// sign-up; here, any non-empty string is a candidate and the hash decides.
export const reauthRequestSchema = z
  .object({
    password: z.string().min(1),
  })
  .strict()

export type ReauthRequest = z.infer<typeof reauthRequestSchema>
