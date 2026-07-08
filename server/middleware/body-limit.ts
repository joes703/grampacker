import { bodyLimit } from 'hono/body-limit'

// Hard cap on request body size for the whole /api subtree, registered
// before anything that consumes a body (Workers get 128 MB of memory;
// an unbounded req.json() is a trivial memory-pressure vector). 128 KB
// is ~4x the largest legitimate payload today, the 500-item gear
// reorder (~30 KB of ids). Slices that genuinely need more (the CSV
// import plan) add a larger per-route limit instead of raising this.
export const API_BODY_LIMIT_BYTES = 128 * 1024

export const apiBodyLimit = bodyLimit({
  maxSize: API_BODY_LIMIT_BYTES,
  onError: (c) => c.json({ error: 'Request body too large' }, 413),
})
