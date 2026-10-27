import { app } from '../test/node-env'
import { describe, expect, it } from 'vitest'

// Real requests through the real static handler (server/middleware/spa.ts,
// serving server/test/fixtures/assets), not fabricated Responses. That
// distinction matters for the missing-asset test: what makes a missing asset
// dangerous is what the HANDLER does with it, so a hand-rolled Response would
// prove nothing about it.
const IMMUTABLE = 'public, max-age=31536000, immutable'

const cacheControl = (res: Response) => res.headers.get('cache-control') ?? ''

describe('asset caching', () => {
  it('content-hashed JS and CSS are cached immutably for a year', async () => {
    for (const path of ['/assets/index-BuiCutTI.js', '/assets/index-9I7GaQPv.css']) {
      const res = await app.request(path, {})
      expect(res.status, path).toBe(200)
      expect(cacheControl(res), path).toBe(IMMUTABLE)
    }
  })

  it('a HEAD request for a hashed asset gets the same immutable policy', async () => {
    const res = await app.request('/assets/index-BuiCutTI.js', { method: 'HEAD' })
    expect(res.status).toBe(200)
    expect(cacheControl(res)).toBe(IMMUTABLE)
  })

  // A 206 is part of a file, not the asset; it must not be frozen.
  it('a range response is not immutable', async () => {
    const res = await app.request('/assets/index-BuiCutTI.js', { headers: { Range: 'bytes=0-3' } })
    expect(res.status).toBe(206)
    expect(cacheControl(res)).not.toBe(IMMUTABLE)
  })

  it('the SPA shell is NOT immutable: it carries the current hashes', async () => {
    // If the shell were frozen, a deploy could never reach a returning browser -
    // it would keep asking for the old hashed bundles forever. must-revalidate on
    // the shell is exactly what makes immutable safe on everything it points to.
    // A deep link falls back to the shell, so it is the shell too. An API
    // response is never immutable either.
    for (const path of ['/', '/lists', '/api/health']) {
      const res = await app.request(path, {})
      expect(res.status, path).toBe(200)
      expect(cacheControl(res), path).not.toContain('immutable')
    }
  })

  it('an UNHASHED path under /assets/ is not immutable', async () => {
    // Only a content hash makes a name safe to freeze: a plain name could be
    // replaced in place, and a year of immutable caching would be unfixable.
    // The fixture file exists, so this is the real PNG and not the SPA
    // fallback, which the content-type guard would refuse for another reason.
    const res = await app.request('/assets/logo.png', {})
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type') ?? '').toContain('image/png')
    expect(cacheControl(res)).not.toContain('immutable')
  })

  it('a MISSING hashed asset is a 404, never the shell, and never frozen', async () => {
    // THE TRAP, and the reason the guard checks content-type and status rather
    // than just the path: if a miss under /assets/ were answered with the SPA
    // shell (200 HTML, as Cloudflare's assets binding did), a path-only rule
    // would stamp `immutable, max-age=1y` onto an HTML body served at a .js
    // URL. Any browser that cached it would be wedged for a year, on a URL we
    // can never change, with no way to bust it: a self-inflicted outage, cached.
    //
    // The Node handler refuses that shape at the source: a miss under /assets/
    // is a 404. Pinned, so a change to the fallback that starts serving the
    // shell here fails this test, and the type allowlist in spa.ts stays the
    // second line of defense.
    const res = await app.request('/assets/nope-12345678.js', {})

    expect(res.status).toBe(404)
    expect(res.headers.get('content-type') ?? '').not.toContain('text/html')
    expect(cacheControl(res)).not.toContain('immutable')
  })

  it('a revalidating browser is upgraded to immutable, not left on a 304', async () => {
    // The bug that would make the immutable policy a no-op for every EXISTING
    // user. Their browsers may hold these assets under an older
    // must-revalidate policy and revalidate with If-None-Match or
    // If-Modified-Since. A 304 carries no Cache-Control, so the stored entry
    // would keep revalidating forever. The static handler never answers 304,
    // so the browser gets the 200 with the immutable policy, once, and stops
    // asking. Pinned so a future switch to an ETag-aware handler cannot
    // silently bring the 304 back.
    const path = '/assets/index-BuiCutTI.js'
    const first = await app.request(path, {})
    const lastModified = first.headers.get('last-modified')
    expect(lastModified).toBeTruthy()

    const revalidated = await app.request(
      path,
      {
        headers: {
          'If-None-Match': '"any-etag"',
          'If-Modified-Since': lastModified!,
        },
      },
    )
    expect(revalidated.status).not.toBe(304)
    expect(revalidated.status).toBe(200)
    expect(cacheControl(revalidated)).toBe(IMMUTABLE)
  })

  it('the shell answers a conditional request with a fresh, revalidating 200', async () => {
    // The shell must stay fresh: it carries the current asset hashes. Without
    // 304 support it is simply re-sent (a few hundred bytes), and it always
    // carries must-revalidate so no cache keeps a stale copy.
    const shell = await app.request('/', {})
    const lastModified = shell.headers.get('last-modified')
    expect(lastModified).toBeTruthy()
    const revalidated = await app.request(
      '/',
      { headers: { 'If-Modified-Since': lastModified! } },
    )
    expect(revalidated.status).toBe(200)
    expect(cacheControl(revalidated)).toBe('public, max-age=0, must-revalidate')
  })
})
