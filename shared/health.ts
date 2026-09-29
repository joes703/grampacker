import { z } from 'zod'

// DTO contract for GET /api/health. The server constructs its response as
// this type, and server/routes/response-contracts.test.ts checks the live
// response against the schema. The SPA never calls /api/health; the routes it
// does call are validated against their schemas in src/lib/api.ts.
export const healthResponseSchema = z.object({ ok: z.boolean() })

export type HealthResponse = z.infer<typeof healthResponseSchema>
