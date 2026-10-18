import { describe, expect, it } from 'vitest'

const html = Object.values(import.meta.glob('/index.html', {
  query: '?raw', import: 'default', eager: true,
}))[0] as string | undefined
const publicFiles = new Set(Object.keys(import.meta.glob('/public/*')))

// A missing icon gets the SPA fallback as 200 HTML, so a successful build
// alone cannot detect a dangling reference in index.html.
describe('index.html icons', () => {
  it('ships the referenced icons and conventional browser fallback files', () => {
    expect(html).toBeTypeOf('string')
    const tags = (html ?? '').match(/<link\b[^>]*>/g) ?? []
    const hrefs = tags.filter((tag) => /rel="(?:icon|apple-touch-icon)"/.test(tag))
      .map((tag) => /href="([^"]+)"/.exec(tag)?.[1])
    expect(hrefs).toEqual(expect.arrayContaining([
      '/favicon.svg', '/favicon.ico', '/apple-touch-icon.png',
    ]))
    for (const href of hrefs) {
      expect(href).toMatch(/^\//)
      expect(publicFiles.has(`/public${href}`), `${href} must ship`).toBe(true)
    }
  })
})
