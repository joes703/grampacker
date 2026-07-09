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
