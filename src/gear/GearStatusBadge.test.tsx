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
    const badge = getByLabelText('Needs repair')
    expect(badge).toBeTruthy()
    expect(badge.className).toContain('bg-amber-50')
    expect(badge.className).toContain('text-amber-800')
    expect(badge.className).toContain('ring-amber-200')
    expect(container.textContent).toContain('Needs repair')
  })

  it('renders the label and accessible name for loaned_out', () => {
    const { getByLabelText, container } = render(<GearStatusBadge status="loaned_out" />)
    const badge = getByLabelText('Loaned out')
    expect(badge).toBeTruthy()
    expect(badge.className).toContain('bg-rose-50')
    expect(badge.className).toContain('text-rose-800')
    expect(badge.className).toContain('ring-rose-200')
    expect(container.textContent).toContain('Loaned out')
  })

  it('renders the label and unavailable treatment for need_to_buy', () => {
    const { getByLabelText, container } = render(<GearStatusBadge status="need_to_buy" />)
    const badge = getByLabelText('Need to buy')
    expect(badge).toBeTruthy()
    expect(badge.className).toContain('bg-rose-50')
    expect(badge.className).toContain('text-rose-800')
    expect(badge.className).toContain('ring-rose-200')
    expect(container.textContent).toContain('Need to buy')
  })

  it('hides the text label in compact mode but keeps the accessible name', () => {
    const { getByLabelText, container } = render(
      <GearStatusBadge status="needs_repair" compact />,
    )
    expect(getByLabelText('Needs repair')).toBeTruthy()
    expect(container.textContent).not.toContain('Needs repair')
  })
})
