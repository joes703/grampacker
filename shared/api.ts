// Cross-boundary API constants. Lives in shared/ because both sides need
// it: the server middleware enforces the header, the SPA fetch wrapper
// sends it (src importing from server/ would drag server code into the
// client bundle).

// Anti-CSRF custom header. A cross-site attacker cannot attach a custom
// header without a CORS preflight, and this server never emits CORS
// headers, so the preflight can never pass. Required on every unsafe
// non-auth /api/* request (server/middleware/csrf.ts).
export const CSRF_HEADER = 'x-grampacker-request'

// Every non-2xx response from an APP-OWNED /api/* route carries this shape.
//
// /api/auth/* is the documented exception, the same way the CSRF header above
// carves it out: those routes belong to better-auth, are consumed by
// better-auth's client, and answer in ITS dialect ({code, message}). The SPA
// reads both fields there - PasskeySection keys its re-auth prompt off `code`,
// auth-errors renders `message` - so imposing this shape on that namespace would
// break the client while making the app's own routes no more uniform.
//
// correlationId appears on unhandled 5xx only, and only when the incident was
// actually logged (server/middleware/error-handler.ts). A handler-returned
// 400/404/409 is not an incident and has no id - hence optional rather than
// required, which would be a lie in the type.
export type ApiErrorBody = { error: string; correlationId?: string }
