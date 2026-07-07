import { z } from 'zod'

// DTO contract for GET /api/health. The server constructs its response as
// this type and the SPA validates the body against the schema, so shape
// drift fails loudly on both sides. Every /api route follows this pattern.
export const healthResponseSchema = z.object({ ok: z.boolean() })

export type HealthResponse = z.infer<typeof healthResponseSchema>
