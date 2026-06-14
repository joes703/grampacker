// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, it, expect } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import TargetStatusMark from './TargetStatusMark'
afterEach(cleanup)
describe('TargetStatusMark', () => {
  it('labels over', () => {
    render(<TargetStatusMark status="over" />)
    expect(screen.getByText('over target')).toBeInTheDocument()
  })
  it('labels under', () => {
    render(<TargetStatusMark status="under" />)
    expect(screen.getByText('under target')).toBeInTheDocument()
  })
  it('marks pass with an sr-only label', () => {
    render(<TargetStatusMark status="pass" />)
    expect(screen.getByText('meets target')).toBeInTheDocument()
  })
  it('renders nothing for neutral', () => {
    const { container } = render(<TargetStatusMark status="neutral" />)
    expect(container).toBeEmptyDOMElement()
  })
})
