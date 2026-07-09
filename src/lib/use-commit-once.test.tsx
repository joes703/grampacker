// @vitest-environment jsdom
import { useState } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useCommitOnce } from './use-commit-once'

// Probe: "fire" routes through the guard; "poke" forces a re-render via
// unrelated state, standing in for the state change every real commit or
// cancel callback performs.
function Probe({ onFire }: { onFire: () => void }) {
  const commitOnce = useCommitOnce()
  const [, setTick] = useState(0)
  return (
    <div>
      <button onClick={() => commitOnce(onFire)}>fire</button>
      <button onClick={() => setTick((t) => t + 1)}>poke</button>
    </div>
  )
}

afterEach(() => {
  cleanup()
})

describe('useCommitOnce', () => {
  it('admits one call per committed render: same-batch duplicates drop', () => {
    const onFire = vi.fn()
    render(<Probe onFire={onFire} />)
    const fire = screen.getByText('fire')
    // One act = one event batch: no re-render between the two deliveries,
    // exactly the Enter+blur pair on an inline edit input.
    act(() => {
      fireEvent.click(fire)
      fireEvent.click(fire)
    })
    expect(onFire).toHaveBeenCalledTimes(1)
  })

  it('re-arms after a re-render', () => {
    const onFire = vi.fn()
    render(<Probe onFire={onFire} />)
    fireEvent.click(screen.getByText('fire'))
    fireEvent.click(screen.getByText('poke'))
    fireEvent.click(screen.getByText('fire'))
    expect(onFire).toHaveBeenCalledTimes(2)
  })

  it('stays consumed until a render actually happens', () => {
    const onFire = vi.fn()
    render(<Probe onFire={onFire} />)
    // onFire causes no state change, so no re-render occurs between these
    // separate batches; the guard holds by design - real commit callbacks
    // always set state (close the editor), which re-arms it.
    fireEvent.click(screen.getByText('fire'))
    fireEvent.click(screen.getByText('fire'))
    expect(onFire).toHaveBeenCalledTimes(1)
  })
})
