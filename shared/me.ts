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
  // How many passkeys the account has. The SPA treats 0 as "setup incomplete"
  // and prompts for enrollment.
  //
  // DERIVED, never stored. A boolean column would be a second source of truth
  // that drifts the moment someone deletes their last passkey, and it would need
  // a migration to add. Counting rows cannot drift and self-heals.
  //
  // This is a PROMPT, not a gate: the API stays usable at 0. A user whose only
  // passkey was on a lost phone has to be able to sign in by email and reach
  // Settings to enroll a new one - gating the app on passkey count would lock
  // out exactly the person the recovery path exists for.
  passkeyCount: z.number().int().nonnegative(),
})

export type MeResponse = z.infer<typeof meResponseSchema>
