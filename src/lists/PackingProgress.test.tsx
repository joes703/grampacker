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
  it('counts packed against the combined total but ready against gear only', () => {
    // 3 gear + 2 packable foods folded into the packed bar (design 8:
    // total = listItems.length + packableTotal). Ready checks are a
    // gear-only feature, so the ready bar keeps its own denominator - under
    // the old shared `total` this would read "3 / 5 ready" and never
    // complete.
    renderProgress({
      total: 5,
      packed: 2,
      readyChecks: { ready: 3, total: 3, onResetReady: () => {} },
    })
    expect(screen.getByText('2 / 5 packed')).toBeTruthy()
    expect(screen.getByText('3 / 3 ready')).toBeTruthy()
    expect(screen.getByText('All ready!')).toBeTruthy()
  })

  // Ready checks used to be a per-list opt-in whose switch lived at the top of
  // this panel, so the ready bar rendered only when the list had opted in.
  // They are unconditional now. Both halves are pinned: the bar always shows,
  // and the switch is gone rather than merely defaulted on - a defaulted-on
  // switch would still let a stray tap take the ready column away.
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
