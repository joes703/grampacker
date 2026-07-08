// Cross-boundary API constants. Lives in shared/ because both sides need
// it: the server middleware enforces the header, the SPA fetch wrapper
// sends it (src importing from server/ would drag server code into the
// client bundle).

// Anti-CSRF custom header. A cross-site attacker cannot attach a custom
// header without a CORS preflight, and this server never emits CORS
// headers, so the preflight can never pass. Required on every unsafe
// non-auth /api/* request (server/middleware/csrf.ts).
export const CSRF_HEADER = 'x-grampacker-request'

// Every non-2xx API response carries this body shape.
export type ApiErrorBody = { error: string }
