// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import TargetStatusMark from './TargetStatusMark'

afterEach(cleanup)

describe('TargetStatusMark', () => {
  it('over: glyph + screen-reader label, never color-only', () => {
    const { container } = render(<TargetStatusMark status="over" />)
    expect(screen.getByText('over target').className).toContain('sr-only')
    expect(container.querySelector('svg')).toBeTruthy()
  })
  it('under: glyph + screen-reader label', () => {
    const { container } = render(<TargetStatusMark status="under" />)
    expect(screen.getByText('under target').className).toContain('sr-only')
    expect(container.querySelector('svg')).toBeTruthy()
  })
  it('pass: sr-only confirmation, no glyph', () => {
    const { container } = render(<TargetStatusMark status="pass" />)
    expect(screen.getByText('meets target').className).toContain('sr-only')
    expect(container.querySelector('svg')).toBeNull()
  })
  it('off / incomplete / neutral render nothing', () => {
    for (const status of ['off', 'incomplete', 'neutral'] as const) {
      const { container } = render(<TargetStatusMark status={status} />)
      expect(container.innerHTML).toBe('')
      cleanup()
    }
  })
})
