// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import MarkdownContent from './MarkdownContent'

// One representative document guards our unsafe-markup configuration. The
// library owns its protocol filtering; our external-link renderer is separate.

afterEach(cleanup)

describe('MarkdownContent XSS hardening', () => {
  it('renders an untrusted document without executable markup', () => {
    const { container } = render(
      <MarkdownContent content={'[click me](javascript:alert(1))\n\n<img src=x onerror="alert(1)">\n\n<script>alert(2)</script>'} />,
    )
    expect(container.querySelector('img, script')).toBeNull()
    const anchor = container.querySelector('a')
    expect(anchor).not.toBeNull()
    const href = anchor?.getAttribute('href') ?? ''
    // react-markdown's defaultUrlTransform strips disallowed protocols,
    // yielding an empty href. The hard requirement is simply: the
    // javascript: scheme must never survive to the rendered href.
    expect(href.toLowerCase()).not.toContain('javascript:')
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
