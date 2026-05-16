// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import GearStatusBadge from './GearStatusBadge'

afterEach(() => {
  cleanup()
})

describe('GearStatusBadge', () => {
  it('renders nothing for the default active status', () => {
    const { container } = render(<GearStatusBadge status="active" />)
    // Component returns null for active so no DOM is committed.
    expect(container.firstChild).toBeNull()
  })

  it('renders the label and accessible name for needs_repair', () => {
    const { getByLabelText, container } = render(<GearStatusBadge status="needs_repair" />)
    expect(getByLabelText('Needs repair')).toBeTruthy()
    expect(container.textContent).toContain('Needs repair')
  })

  it('renders the label and accessible name for loaned_out', () => {
    const { getByLabelText, container } = render(<GearStatusBadge status="loaned_out" />)
    expect(getByLabelText('Loaned out')).toBeTruthy()
    expect(container.textContent).toContain('Loaned out')
  })

  it('hides the text label in compact mode but keeps the accessible name', () => {
    const { getByLabelText, container } = render(
      <GearStatusBadge status="needs_repair" compact />,
    )
    expect(getByLabelText('Needs repair')).toBeTruthy()
    expect(container.textContent).not.toContain('Needs repair')
  })
})
