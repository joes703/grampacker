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
          enabled: true,
          onResetReady: () => {},
          onToggleEnabled: () => {},
        }}
      />,
    )
    expect(screen.getByText('2 / 5 packed')).toBeTruthy()
    expect(screen.getByText('3 / 3 ready')).toBeTruthy()
    expect(screen.getByText('All ready!')).toBeTruthy()
  })
})
