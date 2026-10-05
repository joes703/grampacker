// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import PackingProgress from './PackingProgress'

afterEach(cleanup)

function renderProgress(overrides: Partial<React.ComponentProps<typeof PackingProgress>> = {}) {
  const props: React.ComponentProps<typeof PackingProgress> = {
    total: 3,
    packed: 0,
    onReset: () => {},
    showUnpackedOnly: false,
    onToggleShowUnpackedOnly: () => {},
    showUnreadyOnly: false,
    onToggleShowUnreadyOnly: () => {},
    readyChecks: { ready: 0, total: 3, onResetReady: () => {} },
    ...overrides,
  }
  return render(<PackingProgress {...props} />)
}

describe('PackingProgress', () => {
  it('judges each bar on its own count: all ready does not mean all packed', () => {
    // The page passes the same gear-plus-food total to both bars. Each bar
    // must still finish on its own count: everything ready with packing half
    // done is the normal state the night before a trip.
    renderProgress({
      total: 5,
      packed: 2,
      readyChecks: { ready: 5, total: 5, onResetReady: () => {} },
    })
    expect(screen.getByText('2 / 5 packed')).toBeTruthy()
    expect(screen.getByText('5 / 5 ready')).toBeTruthy()
    expect(screen.getByText('All ready!')).toBeTruthy()
    expect(screen.queryByText('All packed!')).toBeNull()
  })

  // Ready checks are unconditional. Both halves are pinned: the bar always
  // shows, and there is no opt-in switch, not even one defaulted on - such a
  // switch would let a stray tap take the ready column away.
  it('shows the ready bar without any opt-in', () => {
    renderProgress()
    expect(screen.getByText('0 / 3 ready')).toBeTruthy()
    expect(screen.queryByRole('switch', { name: 'Add ready checks' })).toBeNull()
  })

  it('offers one filter switch per metric', () => {
    renderProgress()
    expect(screen.getByRole('switch', { name: 'Show unpacked only' })).toBeTruthy()
    expect(screen.getByRole('switch', { name: 'Show un-ready only' })).toBeTruthy()
  })

  it('reflects each filter switch independently', () => {
    // The two are separate view state, not a single tri-state mode: one on
    // must not imply anything about the other.
    renderProgress({ showUnpackedOnly: true, showUnreadyOnly: false })
    expect(
      screen.getByRole('switch', { name: 'Show unpacked only' }).getAttribute('aria-checked'),
    ).toBe('true')
    expect(
      screen.getByRole('switch', { name: 'Show un-ready only' }).getAttribute('aria-checked'),
    ).toBe('false')
  })

  it('routes each switch to its own handler', async () => {
    // The failure this pins is a copy-paste one: two blocks built from the
    // same sub-component, wired to the same callback.
    const user = userEvent.setup()
    const onToggleUnpacked = vi.fn()
    const onToggleUnready = vi.fn()
    renderProgress({
      onToggleShowUnpackedOnly: onToggleUnpacked,
      onToggleShowUnreadyOnly: onToggleUnready,
    })

    await user.click(screen.getByRole('switch', { name: 'Show un-ready only' }))
    expect(onToggleUnready).toHaveBeenCalledTimes(1)
    expect(onToggleUnpacked).not.toHaveBeenCalled()

    await user.click(screen.getByRole('switch', { name: 'Show unpacked only' }))
    expect(onToggleUnpacked).toHaveBeenCalledTimes(1)
    expect(onToggleUnready).toHaveBeenCalledTimes(1)
  })

  it('disables each reset until that metric has something to reset', () => {
    // Reset packed and Reset ready are gated on their OWN count. Sharing a
    // gate would let "Reset ready" offer to clear nothing, or refuse while
    // ready ticks existed.
    renderProgress({ packed: 2, readyChecks: { ready: 0, total: 3, onResetReady: () => {} } })
    expect(screen.getByRole('button', { name: /Reset packed/ }).hasAttribute('disabled')).toBe(false)
    expect(screen.getByRole('button', { name: /Reset ready/ }).hasAttribute('disabled')).toBe(true)
  })
})
