// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'

// index.html is not imported by any module, so a dangling link in it is invisible
// to every other test here: the app would build, deploy, and serve the icon as
// 200 text/html - the SPA shell, NOT a 404 - with nothing gone red. (A 404 would
// at least be honest; see the fallback note below. An earlier version of this
// comment said "404", which got exactly the finding this file exists to pin
// backwards.) Read the real file (root-relative glob resolves against the project
// root) and check it against the files that must exist to satisfy it.
const htmlModules = import.meta.glob('/index.html', {
  query: '?raw',
  import: 'default',
  eager: true,
})
const html = Object.values(htmlModules)[0] as string | undefined

// Lazy glob on purpose: only the KEYS are read, never the values, so the public
// assets are never actually imported (Vite refuses to bundle out of publicDir,
// and it is right to). The key set is resolved from the filesystem at transform
// time, which is precisely the existence check we want - and it is why a deleted
// favicon turns this red instead of shipping a broken link.
const publicFiles = new Set(Object.keys(import.meta.glob('/public/*')))

// Vite copies publicDir to the site root verbatim, so `/favicon.ico` in the HTML
// is `public/favicon.ico` on disk. That mapping is the whole contract here.
function shippedPath(href: string): string {
  return `/public${href}`
}

function head(): Document {
  expect(html, 'index.html should be readable').toBeTypeOf('string')
  return new DOMParser().parseFromString(html ?? '', 'text/html')
}

describe('index.html', () => {
  it('ships a real /favicon.ico, so the default browser probe misses the SPA fallback', () => {
    // The actual finding (PERF-05). wrangler.jsonc sets not_found_handling:
    // "single-page-application", so ANY path with no matching file is answered
    // with index.html at status 200. A browser with no icon link probes
    // /favicon.ico by convention, and that probe was being served the HTML shell
    // as if it were an image.
    //
    // The <link> tags below do NOT make that request go away - the document
    // links /favicon.ico explicitly, so a browser may well fetch that exact URL,
    // and a crawler or link unfurler that ignores the markup asks for it
    // regardless. The links only steer a browser toward the SVG when it can use
    // one. What closes the finding is a real file at the conventional path, which
    // is what this asserts.
    expect(publicFiles.has('/public/favicon.ico')).toBe(true)
  })

  it('declares both icon formats, and every icon link resolves to a file', () => {
    const links = [...head().querySelectorAll('link[rel="icon"]')]
    const hrefs = links.map((l) => l.getAttribute('href'))

    // SVG is what modern browsers use: one file, every size, sharp on HiDPI.
    // ICO is the fallback and the conventional probe target.
    expect(hrefs).toContain('/favicon.svg')
    expect(hrefs).toContain('/favicon.ico')

    // A link to a file that does not exist is worse than no link: the browser
    // requests it, the SPA fallback answers 200 text/html, and the tab shows a
    // broken icon rather than falling back to anything.
    for (const href of hrefs) {
      expect(href, 'icon links must be site-absolute').toMatch(/^\//)
      expect(
        publicFiles.has(shippedPath(href!)),
        `${href!} is linked but no such file is shipped`,
      ).toBe(true)
    }
  })

  it('types the SVG icon, so a browser can skip it without fetching it', () => {
    // Without type=, a browser that cannot render SVG icons has to fetch it to
    // find out. With it, the ICO is chosen from the markup alone.
    const svg = head().querySelector('link[rel="icon"][href="/favicon.svg"]')
    expect(svg?.getAttribute('type')).toBe('image/svg+xml')
  })

  it('has a non-empty meta description', () => {
    const description = head()
      .querySelector('meta[name="description"]')
      ?.getAttribute('content')
    expect(description?.trim()).toBeTruthy()
  })
})
