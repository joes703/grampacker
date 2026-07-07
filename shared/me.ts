import { z } from 'zod'

// DTO contract for /api/me. The response schema is the allowlist: fields
// not named here never leave the server, and the SPA validates against it.
export const meResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  emailVerified: z.boolean(),
  createdAt: z.string(), // ISO timestamp
})

export type MeResponse = z.infer<typeof meResponseSchema>

export const updateMeRequestSchema = z.object({
  name: z.string().trim().min(1).max(120),
})

export type UpdateMeRequest = z.infer<typeof updateMeRequestSchema>
