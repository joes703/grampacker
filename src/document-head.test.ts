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
  it('declares both icon formats, and every icon link resolves to a file', () => {
    // The files matter even to a client that ignores these links. Any path
    // with no file is answered by the SPA fallback with index.html at 200: a browser probes
    // /favicon.ico by convention, crawlers and link unfurlers ask for it
    // regardless, and iOS asks for /apple-touch-icon.png when saving to the
    // Home Screen. Each would get HTML where it asked for an image.
    //
    // apple-touch-icon.png is deliberately full-bleed and opaque (rendered with
    // `rsvg-convert -w 180 -h 180 -b '#2563eb' public/favicon.svg`). iOS
    // applies its OWN rounded mask, so pre-rounded art would leave transparent
    // corners that iOS composites onto black.
    const links = [
      ...head().querySelectorAll('link[rel="icon"], link[rel="apple-touch-icon"]'),
    ]
    const hrefs = links.map((l) => l.getAttribute('href'))

    // SVG is what modern browsers use: one file, every size, sharp on HiDPI.
    // ICO is the fallback and the conventional probe target.
    expect(hrefs).toContain('/favicon.svg')
    expect(hrefs).toContain('/favicon.ico')
    expect(hrefs).toContain('/apple-touch-icon.png')

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
