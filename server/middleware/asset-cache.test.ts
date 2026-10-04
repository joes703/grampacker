import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import app from '../index'

// Real requests through the real ASSETS binding (server/test/fixtures/assets),
// not fabricated Responses. That distinction is the whole point of the last test
// in this file: what makes a missing asset dangerous is what the BINDING does
// with it, so a hand-rolled Response would prove nothing about it.
const IMMUTABLE = 'public, max-age=31536000, immutable'

const cacheControl = (res: Response) => res.headers.get('cache-control') ?? ''

describe('asset caching', () => {
  it('content-hashed JS and CSS are cached immutably for a year', async () => {
    for (const path of ['/assets/index-BuiCutTI.js', '/assets/index-9I7GaQPv.css']) {
      const res = await app.request(path, {}, env)
      expect(res.status, path).toBe(200)
      expect(cacheControl(res), path).toBe(IMMUTABLE)
    }
  })

  it('the SPA shell is NOT immutable: it carries the current hashes', async () => {
    // If the shell were frozen, a deploy could never reach a returning browser -
    // it would keep asking for the old hashed bundles forever. must-revalidate on
    // the shell is exactly what makes immutable safe on everything it points to.
    const res = await app.request('/', {}, env)
    expect(res.status).toBe(200)
    expect(cacheControl(res)).not.toContain('immutable')
  })

  it('a client-side route is NOT immutable', async () => {
    // Deep links fall back to the shell, so they are the shell, and must not be
    // frozen either.
    const res = await app.request('/lists', {}, env)
    expect(cacheControl(res)).not.toContain('immutable')
  })

  it('API responses are never immutable', async () => {
    const res = await app.request('/api/health', {}, env)
    expect(res.status).toBe(200)
    expect(cacheControl(res)).not.toContain('immutable')
  })

  it('an UNHASHED path under /assets/ is not immutable', async () => {
    // Only a content hash makes a name safe to freeze: a plain name could be
    // replaced in place, and a year of immutable caching would be unfixable.
    // The fixture file exists, so this is the real PNG and not the SPA
    // fallback, which the content-type guard would refuse for another reason.
    const res = await app.request('/assets/logo.png', {}, env)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type') ?? '').toContain('image/png')
    expect(cacheControl(res)).not.toContain('immutable')
  })

  it('a MISSING hashed asset is never frozen, even though it answers 200 HTML', async () => {
    // THE TRAP, and the reason the guard checks content-type and status rather
    // than just the path.
    //
    // wrangler.jsonc sets not_found_handling: "single-page-application", so a
    // request for an asset that does not exist does NOT 404 - the binding serves
    // index.html with status 200. A path-only rule would therefore stamp
    // `immutable, max-age=1y` onto an HTML body served at a .js URL. Any browser
    // that cached it would be wedged for a year, on a URL we can never change,
    // with no way to bust it: a self-inflicted outage, cached.
    //
    // Asserted without pinning the status, because what the binding does with a
    // miss is the binding's business (and differs between miniflare and the
    // edge). The invariant that matters holds either way: this must never come
    // back immutable.
    const res = await app.request('/assets/nope-12345678.js', {}, env)

    // Pinned, not tolerated: this IS the SPA fallback, and if the harness ever
    // stops reproducing it (a 404 instead) then this test quietly degrades into
    // "a 404 is not immutable" and stops guarding anything. Assert the dangerous
    // shape exists, then assert we do not freeze it.
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type') ?? '').toContain('text/html')
    expect(cacheControl(res)).not.toContain('immutable')
  })

  it('a revalidating browser is upgraded to immutable, not left on a 304', async () => {
    // The bug that would have made this whole change a no-op for every EXISTING
    // user - which, on the deploy that ships it, is all of them.
    //
    // Their browsers hold these assets under the old max-age=0, must-revalidate
    // policy, so they revalidate with If-None-Match. A 304 carries no
    // Cache-Control, so the stored entry would keep must-revalidate and keep
    // revalidating forever, and only brand-new visitors would ever benefit.
    //
    // We strip the conditional headers for hashed assets so the binding answers
    // 200 with the immutable policy, once, and the browser stops asking.
    const path = '/assets/index-BuiCutTI.js'
    const first = await app.request(path, {}, env)
    const etag = first.headers.get('etag')
    expect(etag).toBeTruthy()

    const revalidated = await app.request(
      path,
      { headers: { 'If-None-Match': etag! } },
      env,
    )
    expect(revalidated.status).not.toBe(304)
    expect(revalidated.status).toBe(200)
    expect(cacheControl(revalidated)).toBe(IMMUTABLE)
  })

  it('conditional requests for NON-asset paths are left alone', async () => {
    // The strip is scoped to hashed assets. The SPA shell must keep its ordinary
    // revalidation behavior - a 304 on the shell is a cheap, correct answer, and
    // the shell is the one thing that must stay fresh.
    const shell = await app.request('/', {}, env)
    const etag = shell.headers.get('etag')
    // Asserted, not branched on: without an etag there is no conditional
    // request to leave alone, and the test would pass without checking.
    expect(etag).toBeTruthy()
    const revalidated = await app.request('/', { headers: { 'If-None-Match': etag! } }, env)
    expect(revalidated.status).toBe(304)
  })
})
