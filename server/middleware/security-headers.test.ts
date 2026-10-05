import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import app from '../index'
import { securityHeaderMap } from './security-headers'

// Prod-like env: /api/health never touches better-auth, so overriding the
// canonical origin is safe and makes the middleware emit the full
// production set (the test default is localhost = dev mode).
const prodEnv = { ...env, BETTER_AUTH_URL: 'https://grampacker.app' }

// Parse the policy into directives. A bare `csp.toContain('...insights')` cannot
// tell script-src from connect-src, and the whole point of the analytics decision
// is that the beacon origin is allowed in exactly ONE directive - so the loose
// assertion would happily pass a policy that ALSO handed the beacon an
// exfiltration destination.
//
// Parsing every directive (rather than probing a hand-listed few) is what makes
// the "and nowhere else" assertion below actually mean it: a directive nobody
// thought to add to a probe list is precisely the one that would slip through.
// Directive names are case-insensitive per CSP, hence the lowercase.
function parseCsp(csp: string): Map<string, string> {
  const directives = new Map<string, string>()
  for (const raw of csp.split(';')) {
    const trimmed = raw.trim()
    if (trimmed === '') continue
    const name = trimmed.split(/\s+/)[0]!.toLowerCase()
    // Browsers honor the FIRST occurrence and ignore later duplicates, so a
    // duplicate is a silent way to make a policy read stricter than it enforces.
    // Refuse to parse one rather than quietly keeping the first.
    if (directives.has(name)) {
      throw new Error(`duplicate CSP directive: ${name}`)
    }
    directives.set(name, trimmed)
  }
  return directives
}

const INSIGHTS_HOST = 'cloudflareinsights.com'
// Path-restricted on purpose: a host-only source would authorize every current
// and future executable path on that origin, not just the beacon. Both shapes,
// because CSP path matching is EXACT unless the source ends in '/' (then it is a
// prefix match) - and Cloudflare injects the versioned form today.
const INSIGHTS_SRCS = [
  'https://static.cloudflareinsights.com/beacon.min.js',
  'https://static.cloudflareinsights.com/beacon.min.js/',
]

// The script URL Cloudflare actually injects, copied off the wire from
// production. Pinned so a typo in the source above (a missing trailing slash, a
// stray path segment) cannot ship a policy that blocks the very script it was
// written to allow - which is the failure this whole PR exists to fix.
const INJECTED_BEACON_URL =
  'https://static.cloudflareinsights.com/beacon.min.js/v4513226cdae34746b4dedf0b4dfa099e1781791509496'

// CSP source path matching, per spec: a source ending in '/' matches any URL
// whose path starts with it; any other source must match the path exactly.
function sourceAllows(source: string, url: string): boolean {
  if (!url.startsWith(new URL(source).origin)) return false
  const sourcePath = new URL(source).pathname
  const urlPath = new URL(url).pathname
  return sourcePath.endsWith('/') ? urlPath.startsWith(sourcePath) : urlPath === sourcePath
}

describe('security headers', () => {
  it('dev mode drops exactly one header: the CSP', () => {
    const prod = securityHeaderMap({ dev: false })
    const dev = securityHeaderMap({ dev: true })
    expect(prod['Content-Security-Policy']).toBeDefined()
    expect(dev['Content-Security-Policy']).toBeUndefined()
    expect(Object.keys(prod).filter((k) => k !== 'Content-Security-Policy')).toEqual(
      Object.keys(dev),
    )
  })

  it('the production CSP keeps the load-bearing directives', () => {
    const csp = securityHeaderMap({ dev: false })['Content-Security-Policy'] ?? ''
    for (const directive of [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self'",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ]) {
      expect(csp).toContain(directive)
    }
    // React styles go through the CSSOM, so nothing needs inline
    // allowances - keep it that way.
    expect(csp).not.toContain('unsafe-inline')
    // The Supabase origins died with the old stack.
    expect(csp).not.toContain('supabase')
  })

  it('allows the Cloudflare Web Analytics beacon in script-src, and ONLY there', () => {
    // Cloudflare injects the beacon into our HTML at the edge (verified on the
    // wire; it only injects when the request sends Accept: text/html, so a
    // plain curl shows a clean document). With `script-src 'self'` the browser
    // blocked it on every page load: analytics collected nothing, and a
    // permanent CSP violation sat in the console ready to mask a real one.
    // Allowing it is a deliberate expansion of script trust, taken because the
    // alternative was paying the cost and getting no data.
    //
    // parseCsp throws on a duplicate directive, so this also proves there is
    // none (see parseCsp for why a duplicate is dangerous).
    const csp = parseCsp(securityHeaderMap({ dev: false })['Content-Security-Policy'] ?? '')

    // Path-restricted, not host-wide: a host-only source authorizes every
    // executable path on that origin, forever, including whatever Cloudflare
    // decides to host there next.
    expect(csp.get('script-src')).toBe(`script-src 'self' ${INSIGHTS_SRCS.join(' ')}`)

    // ...and the policy must actually permit the script Cloudflare really
    // injects. A path-restricted source that does not match the live URL would
    // be a stricter-looking policy that leaves the beacon just as blocked as
    // before.
    expect(INSIGHTS_SRCS.some((src) => sourceAllows(src, INJECTED_BEACON_URL))).toBe(true)

    // The load-bearing half. An edge-injected beacon reports to the SAME-ORIGIN
    // /cdn-cgi/rum (only a manually-embedded one talks to cloudflareinsights.com),
    // already covered by `connect-src 'self'`. Adding the static origin here
    // would hand a third-party script somewhere to send data - the exact shape of
    // an exfiltration channel - in exchange for nothing it needs.
    expect(csp.get('connect-src')).toBe("connect-src 'self'")

    // default-src is the fallback for every directive we do not name, so the
    // beacon origin leaking into it would quietly widen img-src, font-src,
    // manifest-src and worker-src at once.
    expect(csp.get('default-src')).toBe("default-src 'self'")

    // script-src-elem OVERRIDES script-src for external <script> elements, so a
    // policy could look locked down here and be wide open in practice. We do not
    // set it; if someone adds it, this test makes them think about the beacon.
    expect(csp.has('script-src-elem')).toBe(false)
    expect(csp.has('script-src-attr')).toBe(false)

    // "And nowhere else", meant literally: every OTHER directive, including any
    // added after this was written, must be free of the beacon origin.
    for (const [name, value] of csp) {
      if (name === 'script-src') continue
      expect(value, `${name} must not mention the beacon origin`).not.toContain(INSIGHTS_HOST)
    }
  })

  it('API responses carry the full production set', async () => {
    const res = await app.request('/api/health', {}, prodEnv)
    expect(res.status).toBe(200)
    for (const [key, value] of Object.entries(securityHeaderMap({ dev: false }))) {
      expect(res.headers.get(key)).toBe(value)
    }
  })

  it('error responses carry the set too', async () => {
    // A CSRF-refused request still gets headers: the middleware wraps
    // every response, not just happy paths.
    const res = await app.request(
      '/api/me',
      { method: 'PUT', body: '{}' },
      prodEnv,
    )
    expect(res.status).toBe(403)
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(res.headers.get('Content-Security-Policy')).toBeDefined()
  })

  it('unknown /api/* paths return JSON 404, not the SPA shell', async () => {
    const res = await app.request('/api/definitely-not-a-route', {}, prodEnv)
    expect(res.status).toBe(404)
    expect(res.headers.get('content-type') ?? '').toContain('application/json')
  })

  it('the SPA shell carries the full production set', async () => {
    const res = await app.request('/', {}, prodEnv)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type') ?? '').toContain('text/html')
    for (const [key, value] of Object.entries(securityHeaderMap({ dev: false }))) {
      expect(res.headers.get(key)).toBe(value)
    }
  })
})
