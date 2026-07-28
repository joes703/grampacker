// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ToastViewport from './Toast'
import { clearToasts, showToast } from '../lib/toast'

afterEach(() => {
  cleanup()
  clearToasts()
})

// Toasts gained an optional ACTION so a removal can be undone without a
// confirm dialog standing in front of every removal. An action button that
// fires twice, or that outlives the session that created it, is worse than no
// undo at all - it writes to a list the user is no longer looking at.

describe('ToastViewport', () => {
  it('renders nothing when there are no toasts', () => {
    render(<ToastViewport />)
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('renders a plain toast with no action button', () => {
    render(<ToastViewport />)
    act(() => {
      showToast('Saved')
    })

    expect(screen.getByText('Saved')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
  })

  it('renders an action button and invokes it on click', async () => {
    const user = userEvent.setup()
    const onAction = vi.fn()
    render(<ToastViewport />)
    act(() => {
      showToast('Removed "Tarp"', { action: { label: 'Undo', onAction } })
    })

    await user.click(screen.getByRole('button', { name: 'Undo' }))
    expect(onAction).toHaveBeenCalledTimes(1)
  })

  it('dismisses the toast when its action is used', async () => {
    // Dismiss-then-invoke, so an impatient second click cannot fire a second
    // re-add: the card is gone before onAction starts.
    const user = userEvent.setup()
    render(<ToastViewport />)
    act(() => {
      showToast('Removed "Tarp"', { action: { label: 'Undo', onAction: () => {} } })
    })

    await user.click(screen.getByRole('button', { name: 'Undo' }))
    expect(screen.queryByText('Removed "Tarp"')).toBeNull()
  })

  it('still offers the separate dismiss control alongside an action', async () => {
    // Dismissing must not be the same gesture as undoing - tapping the X to
    // get the toast out of the way should NOT put the item back.
    const user = userEvent.setup()
    const onAction = vi.fn()
    render(<ToastViewport />)
    act(() => {
      showToast('Removed "Tarp"', { action: { label: 'Undo', onAction } })
    })

    await user.click(screen.getByRole('button', { name: 'Dismiss notification' }))
    expect(screen.queryByText('Removed "Tarp"')).toBeNull()
    expect(onAction).not.toHaveBeenCalled()
  })
})

describe('clearToasts', () => {
  it('drops live toasts and their pending actions', () => {
    // Called on sign-out. The store is module-level and its viewport sits
    // above the authenticated routes, so without this an Undo button survives
    // the session boundary and fires a write against the previous user's
    // list.
    render(<ToastViewport />)
    act(() => {
      showToast('Removed "Tarp"', { action: { label: 'Undo', onAction: () => {} } })
    })
    expect(screen.getByText('Removed "Tarp"')).toBeInTheDocument()

    act(() => {
      clearToasts()
    })
    expect(screen.queryByText('Removed "Tarp"')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
  })
})
