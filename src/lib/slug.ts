// 6-character base62 slug for shared lists. The slug is the public URL
// handle — it appears in /r/<slug>. Anyone with the URL can read the list
// while is_shared = true; we don't authenticate share-view requests, but
// we also don't call the slug a credential since it isn't user-issued or
// password-like. See SECURITY.md "Public read paths (sharing)" for the
// trust model.
//
// Modulo bias: 62 doesn't divide 256, so byte % 62 would over-sample the
// first 8 indices. Rejection sampling on bytes ≥ 248 (256 - 256 % 62)
// gives a uniform draw. Defense-in-depth — for a non-credential identifier
// the bias was always tiny — but free hygiene while we're touching this.

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
const SLUG_LENGTH = 6
const REJECT_THRESHOLD = 256 - (256 % ALPHABET.length) // 248

export function generateSlug(): string {
  const out: string[] = []
  while (out.length < SLUG_LENGTH) {
    // Overshoot: most bytes pass the rejection threshold, so refilling
    // every byte one at a time would cost extra crypto.getRandomValues
    // calls. Allocate enough headroom that one refill almost always
    // produces SLUG_LENGTH usable bytes.
    const buf = new Uint8Array(SLUG_LENGTH * 2)
    crypto.getRandomValues(buf)
    for (const b of buf) {
      if (b >= REJECT_THRESHOLD) continue
      // Non-null assertion: b % ALPHABET.length is always in range
      // [0, ALPHABET.length), so ALPHABET[...] is always defined.
      out.push(ALPHABET[b % ALPHABET.length]!)
      if (out.length === SLUG_LENGTH) break
    }
  }
  return out.join('')
}
