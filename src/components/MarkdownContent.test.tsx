// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import MarkdownContent from './MarkdownContent'

// SAFETY REGRESSION SUITE.
//
// MarkdownContent renders untrusted user-authored markdown (shared list
// notes, descriptions). Auth tokens live in localStorage, so any XSS here
// is full account compromise; the load-bearing mitigation is that
// react-markdown (a) ignores raw HTML when rehype-raw is NOT enabled and
// (b) sanitizes link/image URLs via its default urlTransform
// (javascript:/data: blocked). See the SAFETY header in MarkdownContent.tsx
// and SECURITY.md "Accepted residual risks".
//
// These tests pin those guarantees so a future dependency bump (a
// react-markdown major that changes default sanitization) or an accidental
// `rehype-raw` / custom `urlTransform` addition fails loudly here instead
// of silently re-opening the XSS surface.

afterEach(cleanup)

describe('MarkdownContent XSS hardening', () => {
  it('does not execute a javascript: link href (sanitized to a non-javascript URL)', () => {
    const { container } = render(
      <MarkdownContent content="[click me](javascript:alert(1))" />,
    )
    const anchor = container.querySelector('a')
    expect(anchor).not.toBeNull()
    const href = anchor?.getAttribute('href') ?? ''
    // react-markdown's defaultUrlTransform strips disallowed protocols,
    // yielding an empty href. The hard requirement is simply: the
    // javascript: scheme must never survive to the rendered href.
    expect(href.toLowerCase()).not.toContain('javascript:')
  })

  it('does not pass through a data: link href', () => {
    const { container } = render(
      <MarkdownContent content="[x](data:text/html,<script>alert(1)</script>)" />,
    )
    const href = container.querySelector('a')?.getAttribute('href') ?? ''
    expect(href.toLowerCase()).not.toContain('data:text/html')
  })

  it('does not render raw HTML elements (no rehype-raw)', () => {
    const { container } = render(
      <MarkdownContent content={'<img src=x onerror="alert(1)">\n\n<script>alert(2)</script>'} />,
    )
    // Without rehype-raw, raw HTML is inert text, not live DOM. If either
    // of these starts matching, raw HTML rendering has been turned on.
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('script')).toBeNull()
  })

  it('marks external http(s) links with target=_blank and rel=noopener noreferrer', () => {
    const { container } = render(
      <MarkdownContent content="[site](https://example.com)" />,
    )
    const anchor = container.querySelector('a')
    expect(anchor?.getAttribute('href')).toBe('https://example.com')
    expect(anchor?.getAttribute('target')).toBe('_blank')
    // rel must pair noopener with noreferrer to prevent tabnabbing /
    // referrer leakage (codebase convention; see CLAUDE.md).
    expect(anchor?.getAttribute('rel')).toBe('noopener noreferrer')
  })
})
