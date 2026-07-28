// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import PackingProgress from './PackingProgress'

afterEach(cleanup)

describe('PackingProgress', () => {
  it('counts packed against the combined total but ready against gear only', () => {
    // 3 gear + 2 packable foods folded into the packed bar (design 8:
    // total = listItems.length + packableTotal). Ready checks are a
    // gear-only feature, so the ready bar keeps its own denominator - under
    // the old shared `total` this would read "3 / 5 ready" and never
    // complete.
    render(
      <PackingProgress
        total={5}
        packed={2}
        onReset={() => {}}
        showUnpackedOnly={false}
        onToggleShowUnpackedOnly={() => {}}
        readyChecks={{
          ready: 3,
          total: 3,
          onResetReady: () => {},
        }}
      />,
    )
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
    render(
      <PackingProgress
        total={3}
        packed={0}
        onReset={() => {}}
        showUnpackedOnly={false}
        onToggleShowUnpackedOnly={() => {}}
        readyChecks={{ ready: 0, total: 3, onResetReady: () => {} }}
      />,
    )
    expect(screen.getByText('0 / 3 ready')).toBeTruthy()
    expect(screen.queryByRole('switch', { name: 'Add ready checks' })).toBeNull()
  })

  it('keeps the unpacked-only switch', () => {
    // The other switch in that cluster must survive the removal of the ready
    // one - they lived in the same flex row.
    render(
      <PackingProgress
        total={3}
        packed={0}
        onReset={() => {}}
        showUnpackedOnly={false}
        onToggleShowUnpackedOnly={() => {}}
        readyChecks={{ ready: 0, total: 3, onResetReady: () => {} }}
      />,
    )
    expect(screen.getByRole('switch', { name: 'Show unpacked only' })).toBeTruthy()
  })
})
