import { z } from 'zod'

// Request-schema primitives shared by the domain DTO modules (gear, lists,
// food, the imports). A leaf module, like ./decimal, so those modules can
// share shapes without importing each other. Only genuinely identical
// contracts live here: name bounds differ per domain (food 128, gear/list
// 256, packing location 60) and stay in their own modules as named
// constants - one generic name schema would be an unnamed behavior change.

// Opaque id in a request body: a server-minted row id the client echoes
// back. The bound is a transport sanity cap, not a format check - ids are
// never parsed.
export const idSchema = z.string().min(1).max(64)

// Client-minted placeholder id linking the layers of an import payload. The
// same bounds as idSchema, but a separate contract: the server resolves it
// against the payload, never against a table.
export const tempIdSchema = z.string().min(1).max(64)

export function uniqueIds(ids: readonly string[]): boolean {
  return new Set(ids).size === ids.length
}

// PATCH bodies: at least one field must be DEFINED. Rejecting
// `{name: undefined}` as well as `{}` keeps absent and explicitly-undefined
// fields meaning the same "unchanged" - a patch carrying only undefined
// fields is a no-op the caller did not intend. One idiom and one message so
// every patch schema speaks the same dialect.
export function nonEmptyPatch<S extends z.ZodType<Record<string, unknown>>>(
  schema: S,
): S {
  return schema.refine(
    (v) => Object.values(v).some((field) => field !== undefined),
    { message: 'empty patch' },
  )
}

// Description fields (gear and lists share the bound). Empty string is not a
// valid description - clients send null to clear.
export const MAX_DESC_LENGTH = 2000
export const descriptionSchema = z.string().trim().min(1).max(MAX_DESC_LENGTH)

// Signed document sort order (gear, categories, lists, list items). Pack
// ranks are NOT this schema - they are unsigned; see packRankSchema in
// ./lists.
export const sortOrderSchema = z
  .number()
  .int()
  .min(-1_000_000_000)
  .max(1_000_000_000)
