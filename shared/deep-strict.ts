import { z } from 'zod'

// Recursively strict variants of the response schemas, for the places where
// an UNEXPECTED field must fail loudly: the share route's server-side parse
// and the API response-contract tests. The browser's runtime schemas stay
// tolerant (strip) on purpose - an old bundle receiving one additive field
// from a newer server must not report a COMMITTED write as a failure
// (review P2.13, owner decision 2026-08-05).
//
// Walks only the shapes the response schemas actually use - object, array,
// nullable, optional, union - via zod's public accessors. Anything else
// (primitives, enums) passes through untouched. deep-strict.test.ts pins
// every exported response schema's nesting against this walker, so a zod
// upgrade that changed these accessors would fail tests rather than
// silently returning a non-strict schema.
// Rebuilding a container makes a FRESH schema, and zod does not carry
// container-level checks (.refine, array .min/.max) across that rebuild.
// Silently dropping one would make the "strict" variant WEAKER than the
// original in that dimension, so a check-bearing container fails closed:
// whoever adds the first refined response container extends the walker
// deliberately instead of losing the check by accident.
function assertNoContainerChecks(schema: z.ZodType, kind: string): void {
  const checks = (schema.def as { checks?: unknown[] }).checks
  if (checks && checks.length > 0) {
    throw new Error(
      `deepStrict cannot preserve ${kind}-level checks (refine/min/max); ` +
        'extend shared/deep-strict.ts before using one on a response schema',
    )
  }
}

export function deepStrict(schema: z.ZodType): z.ZodType {
  if (schema instanceof z.ZodObject) {
    assertNoContainerChecks(schema, 'object')
    const shape = schema.shape as Record<string, z.ZodType>
    const strictShape: Record<string, z.ZodType> = {}
    for (const [key, value] of Object.entries(shape)) {
      strictShape[key] = deepStrict(value)
    }
    return z.strictObject(strictShape)
  }
  if (schema instanceof z.ZodArray) {
    assertNoContainerChecks(schema, 'array')
    return z.array(deepStrict(schema.element as z.ZodType))
  }
  if (schema instanceof z.ZodNullable) {
    return deepStrict(schema.unwrap() as z.ZodType).nullable()
  }
  if (schema instanceof z.ZodOptional) {
    return deepStrict(schema.unwrap() as z.ZodType).optional()
  }
  if (schema instanceof z.ZodUnion) {
    assertNoContainerChecks(schema, 'union')
    const options = (schema.options as z.ZodType[]).map(deepStrict)
    return z.union(options as [z.ZodType, z.ZodType, ...z.ZodType[]])
  }
  return schema
}
