// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/react'
import GearStatusMenuItems from './GearStatusMenuItems'

afterEach(() => {
  cleanup()
})

describe('GearStatusMenuItems', () => {
  it('renders one menu item per status with the spec labels', () => {
    const { getByRole } = render(
      <GearStatusMenuItems current="active" onSelect={() => {}} />,
    )
    expect(getByRole('menuitemradio', { name: 'Active' })).toBeTruthy()
    expect(getByRole('menuitemradio', { name: 'Needs repair' })).toBeTruthy()
    expect(getByRole('menuitemradio', { name: 'Loaned out' })).toBeTruthy()
  })

  it('marks only the current status as checked', () => {
    const { getByRole } = render(
      <GearStatusMenuItems current="needs_repair" onSelect={() => {}} />,
    )
    expect(getByRole('menuitemradio', { name: 'Active' }).getAttribute('aria-checked')).toBe('false')
    expect(getByRole('menuitemradio', { name: 'Needs repair' }).getAttribute('aria-checked')).toBe('true')
    expect(getByRole('menuitemradio', { name: 'Loaned out' }).getAttribute('aria-checked')).toBe('false')
  })

  it('fires onSelect with the chosen status when a non-current option is clicked', () => {
    const onSelect = vi.fn()
    const { getByRole } = render(
      <GearStatusMenuItems current="active" onSelect={onSelect} />,
    )
    fireEvent.click(getByRole('menuitemradio', { name: 'Loaned out' }))
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect).toHaveBeenCalledWith('loaned_out')
  })

  it('does NOT fire onSelect when the current status is clicked (avoids no-op PATCH)', () => {
    const onSelect = vi.fn()
    const { getByRole } = render(
      <GearStatusMenuItems current="needs_repair" onSelect={onSelect} />,
    )
    fireEvent.click(getByRole('menuitemradio', { name: 'Needs repair' }))
    expect(onSelect).not.toHaveBeenCalled()
  })
})
