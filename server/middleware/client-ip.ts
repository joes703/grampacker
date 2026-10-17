// Turns a client IP into a rate-limit bucket key.
//
// Why this is not just the raw address: a single residential IPv6
// allocation is a /64 (or shorter), so the client can pick any of 2^64
// source addresses inside it at will. Keying the limiter on the exact
// address therefore hands an IPv6 attacker an unlimited supply of fresh
// buckets and the sign-up / sign-in / email-send budgets stop meaning
// anything. Group IPv6 by its /64; IPv4 stays exact (a /32 IS the host).
//
// The dangerous failure mode to avoid is the IPv4-MAPPED form
// (`::ffff:1.2.3.4`): treated naively it expands to leading zeroes and
// every IPv4 client collapses into ONE bucket `0:0:0:0::/64`, which
// would lock out the whole internet as soon as anyone got limited. So a
// mapped address is unwrapped back to its IPv4 address instead.
//
// Anything unparseable is keyed by its own raw text: unknown input must
// never merge distinct clients into a shared bucket.

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/
const HEXTET = /^[0-9a-f]{1,4}$/

function ipv4Octets(value: string): [number, number, number, number] | null {
  const m = IPV4.exec(value)
  if (!m) return null
  const octets = [m[1], m[2], m[3], m[4]].map((part) => Number(part))
  const [a, b, c, d] = octets
  if (a === undefined || b === undefined || c === undefined || d === undefined) {
    return null
  }
  if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null
  return [a, b, c, d]
}

// Expands any valid IPv6 text form to exactly 8 hextets, leading zeroes
// stripped ('2001:0db8::1' -> ['2001','db8','0','0','0','0','0','1']).
// Returns null if the input is not a valid IPv6 address.
function hextets(value: string): string[] | null {
  let text = value

  // A trailing dotted-quad (`::ffff:1.2.3.4`) is a legal IPv6 spelling.
  // Fold it into the two hextets it stands for before expanding.
  if (text.includes('.')) {
    const lastColon = text.lastIndexOf(':')
    if (lastColon === -1) return null
    const octets = ipv4Octets(text.slice(lastColon + 1))
    if (!octets) return null
    const [a, b, c, d] = octets
    const high = ((a << 8) | b).toString(16)
    const low = ((c << 8) | d).toString(16)
    text = `${text.slice(0, lastColon + 1)}${high}:${low}`
  }

  const halves = text.split('::')
  if (halves.length > 2) return null
  const split = (part: string | undefined) =>
    part === undefined || part === '' ? [] : part.split(':')
  const left = split(halves[0])
  const right = halves.length === 2 ? split(halves[1]) : []

  let groups: string[]
  if (halves.length === 1) {
    if (left.length !== 8) return null
    groups = left
  } else {
    const fill = 8 - left.length - right.length
    // '::' must stand for at least one omitted group.
    if (fill < 1) return null
    groups = [...left, ...Array<string>(fill).fill('0'), ...right]
  }

  if (!groups.every((g) => HEXTET.test(g))) return null
  return groups.map((g) => parseInt(g, 16).toString(16))
}

export function rateLimitIpKey(rawIp: string): string {
  const trimmed = rawIp.trim().toLowerCase()
  if (trimmed === '') return 'unknown'

  // Zone ids ('fe80::1%eth0') are a local-scope artifact, not part of the
  // address, so strip them before parsing. Only for things that look like
  // IPv6, though: stripping unconditionally would make the garbage inputs
  // 'bad%a' and 'bad%b' share the fallback bucket 'bad', and unknown input
  // must never merge distinct clients.
  const ip = trimmed.includes(':') ? (trimmed.split('%')[0] ?? '') : trimmed

  // Canonicalize IPv4 from its parsed octets rather than echoing the input:
  // '001.002.003.004' and '1.2.3.4' are the same host and must land in the
  // same bucket. Echoing the raw text would give one client two budgets.
  const octets = ipv4Octets(ip)
  if (octets) return octets.join('.')

  const groups = hextets(ip)
  if (!groups) return ip

  const [h0, h1, h2, h3, h4, h5, h6, h7] = groups

  // IPv4-mapped: ::ffff:a.b.c.d. Unwrap to the IPv4 address so these key
  // identically to the same client arriving as plain IPv4 - and, more to
  // the point, so they do not all share one bucket.
  const mapped =
    h0 === '0' && h1 === '0' && h2 === '0' && h3 === '0' && h4 === '0' && h5 === 'ffff'
  if (mapped && h6 !== undefined && h7 !== undefined) {
    const high = parseInt(h6, 16)
    const low = parseInt(h7, 16)
    return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`
  }

  return `${h0}:${h1}:${h2}:${h3}::/64`
}

// The client address behind Caddy: the RIGHTMOST X-Forwarded-For entry.
//
// Caddy's reverse_proxy always writes X-Forwarded-For. With no
// trusted_proxies configured (our Caddyfile sets none) it REPLACES whatever
// the client sent with the connection's address; if trusted proxies were
// ever added, it would append that address to their list instead. Either
// way the last entry is the peer Caddy itself saw, which the client cannot
// choose. Earlier entries, and any other header (X-Real-IP passes through
// Caddy untouched unless the config overwrites it), can be forged.
//
// Trusted only because the app port is reachable from localhost alone
// Anything that reaches the
// port directly could still write its own header. undefined when the header
// is absent or empty - local dev and tests - where callers fall back to one
// shared bucket.
export function clientIpFromForwardedFor(header: string | undefined): string | undefined {
  if (header === undefined) return undefined
  const last = header.split(',').at(-1)?.trim()
  return last === undefined || last === '' ? undefined : last
}
