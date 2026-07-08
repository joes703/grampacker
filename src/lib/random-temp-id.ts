// crypto.randomUUID requires a secure context (HTTPS or localhost). Two
// failure modes hit otherwise:
// - `vite preview` over plain HTTP on a non-localhost LAN address (phone
//   testing) — randomUUID is undefined, throws "is not a function".
// - Older Safari (<16.4, May 2023) — predates the API shipping in WebKit.
//
// Both produce uuid v4-shaped strings (RFC 4122). The native path is the
// happy path; the manual fallback uses crypto.getRandomValues to fill 16
// bytes, sets the version (4) and variant (10xx) bits, and formats with
// hyphens. Math.random fallback isn't included — every browser this
// codebase otherwise supports has crypto.getRandomValues.
//
// Used by optimistic-update sites that need a synthetic id before the
// server's authoritative id arrives. The "temp-" prefix is NOT applied
// here (the optimistic-list-placeholder helper deliberately uses bare
// uuids per its DB-validity guardrail; the gear/list-item callers prefix
// at the call site).
export function randomTempId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  // Explicit failure mode: every browser this codebase supports has
  // crypto.getRandomValues (IE11+, universal). If neither randomUUID nor
  // getRandomValues is present, the environment is broken in ways that
  // would also affect Supabase auth and other crypto consumers — fail
  // loudly with a diagnosable message rather than letting a later
  // ReferenceError surface.
  if (typeof crypto === 'undefined' || typeof crypto.getRandomValues !== 'function') {
    throw new Error('randomTempId: crypto.getRandomValues is unavailable')
  }
  // Manual uuid v4 from 16 random bytes. Version (bits 12-15 of byte 6)
  // and variant (bits 6-7 of byte 8) are set per RFC 4122 §4.4.
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'))
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`
}
