import { bodyLimit } from 'hono/body-limit'
import { createMiddleware } from 'hono/factory'

// Hard cap on request body size for the whole /api subtree, registered
// before anything that consumes a body (Workers get 128 MB of memory;
// an unbounded req.json() is a trivial memory-pressure vector). 128 KB
// is ~4x the largest legitimate non-import payload, the 500-item gear
// reorder (~30 KB of ids).
export const API_BODY_LIMIT_BYTES = 128 * 1024

// The import routes are the one exception, and they need their own cap
// because this middleware runs BEFORE any route: a route-level limit
// registered later can never widen a global one that already refused the
// body. Before this existed the two limits silently contradicted each
// other - the DTOs accept 2000 rows, which no 128 KB body can carry, so
// a legitimate CSV import 413'd.
//
// 2 MB is a TRANSPORT bound, deliberately not derived from the DTO's
// worst case. Deriving it would be a trap: zod's `.max()` counts
// characters while a body limit counts BYTES, and UTF-8 runs up to 3
// bytes per character, so the worst case a DTO accepts (2000 items x
// 2000-char descriptions) is over 13 MB - a cap we do not want to hold
// open in a 128 MB isolate for an endpoint that only needs to carry real
// CSV data (a fat gear row is ~300 bytes, so 2000 rows is well under
// 1 MB). A pathological import can therefore still 413. That is the
// intended behavior, not a bug: the DTO bounds semantics, this bounds
// transport, and the 413 tells the client to split the file.
export const IMPORT_BODY_LIMIT_BYTES = 2 * 1024 * 1024

// Exact paths, not a prefix: a prefix match would silently hand the
// larger cap to any future route that happens to sit under one of these.
const IMPORT_PATHS = new Set(['/api/gear-items/import', '/api/lists/import'])

const tooLarge = (maxBytes: number) =>
  bodyLimit({
    maxSize: maxBytes,
    onError: (c) => c.json({ error: 'Request body too large' }, 413),
  })

const standardLimit = tooLarge(API_BODY_LIMIT_BYTES)
const importLimit = tooLarge(IMPORT_BODY_LIMIT_BYTES)

export const apiBodyLimit = createMiddleware(async (c, next) => {
  const limit = IMPORT_PATHS.has(c.req.path) ? importLimit : standardLimit
  return limit(c, next)
})
