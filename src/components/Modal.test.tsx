// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/react'
import Modal from './Modal'

// jsdom (29.x at install time) doesn't implement <dialog>.showModal() / .close().
// The Modal component drives those imperatively via a useEffect, so without
// these shims the test render either throws or leaves dialog.open === false
// regardless of the `open` prop. close() must dispatch the native 'close'
// event so React's onClose prop (delegated via the dialog's onClose listener)
// fires through the same path production uses.
//
// showModal() in real browsers also auto-focuses the first sequentially
// focusable descendant. The shim mirrors that so the focus-redirect test
// below is a true regression check — without the shim's auto-focus side
// effect, the test would pass trivially even if the production redirect
// were reverted.
beforeAll(() => {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function () {
      this.setAttribute('open', '')
      const first = this.querySelector<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      )
      first?.focus()
    }
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function () {
      this.removeAttribute('open')
      this.dispatchEvent(new Event('close'))
    }
  }
})

afterEach(() => {
  cleanup()
})

describe('Modal', () => {
  it('closes on backdrop click (target === currentTarget)', () => {
    const onClose = vi.fn()
    const { container } = render(
      <Modal open={true} onClose={onClose} title="Test">
        <div data-testid="content">content</div>
      </Modal>,
    )

    const dialog = container.querySelector('dialog')
    expect(dialog).not.toBeNull()
    // Click directly on the dialog element — with the current p-0 +
    // inner-wrapper structure, this represents a click on the ::backdrop
    // area. The handler closes the dialog, which fires its native close
    // event, which routes to the onClose prop.
    fireEvent.click(dialog!, { target: dialog, currentTarget: dialog })

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does not close on click inside dialog content (target !== currentTarget)', () => {
    const onClose = vi.fn()
    const { container, getByTestId } = render(
      <Modal open={true} onClose={onClose} title="Test">
        <div data-testid="content">content</div>
      </Modal>,
    )
    // Content outside the dialog would also miss the dialog on click, so
    // pin where it renders.
    expect(container.querySelector('dialog')).toContainElement(getByTestId('content'))

    fireEvent.click(getByTestId('content'))

    expect(onClose).not.toHaveBeenCalled()
  })

  it('respects closeOnBackdropClick={false}', () => {
    const onClose = vi.fn()
    const { container } = render(
      <Modal open={true} onClose={onClose} title="Test" closeOnBackdropClick={false}>
        <div>content</div>
      </Modal>,
    )

    const dialog = container.querySelector('dialog')
    expect(dialog).not.toBeNull()
    fireEvent.click(dialog!, { target: dialog, currentTarget: dialog })

    expect(onClose).not.toHaveBeenCalled()
  })

  it('fires onClose when the native close event dispatches (Escape / programmatic close)', () => {
    // Real browsers fire the dialog's `close` event on Escape and on any
    // call to `dialog.close()`. The component's onClose prop is wired
    // through React's `<dialog onClose>` listener. Calling close()
    // directly here bypasses the backdrop-click path and asserts the
    // native-close → React onClose handoff works on its own.
    const onClose = vi.fn()
    const { container } = render(
      <Modal open={true} onClose={onClose} title="Test">
        <div>content</div>
      </Modal>,
    )
    const dialog = container.querySelector('dialog')
    expect(dialog).not.toBeNull()

    dialog!.close()

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('moves initial focus to the dialog itself, not the first focusable child', () => {
    // Native dialog.showModal() auto-focuses the first focusable
    // descendant. On a touch-tap open that renders as a visible focus
    // ring on whatever happens to come first (e.g. the first toggle in
    // List options), which reads as an accidental selection. Modal
    // explicitly refocuses the dialog after showModal() so the
    // indicator doesn't appear — keyboard users still Tab into the
    // first control next because the dialog is tabIndex={-1}.
    const { container } = render(
      <Modal open={true} onClose={() => {}} title="Test">
        <button type="button">first focusable</button>
      </Modal>,
    )
    const dialog = container.querySelector('dialog')
    expect(dialog).not.toBeNull()
    expect(document.activeElement).toBe(dialog)
  })
})

// Opt-in header chrome: one title + close-X recipe instead of each dialog
// re-typing its own h2. The X must honor preventDismiss - it is a dismissal
// path like Escape and the backdrop.
describe('Modal header', () => {
  it('renders the title heading and a close X that calls onClose', () => {
    const onClose = vi.fn()
    const { getByRole } = render(
      <Modal open onClose={onClose} title="Create thing" header>
        <div>body</div>
      </Modal>,
    )
    expect(getByRole('heading', { name: 'Create thing' })).toBeTruthy()
    fireEvent.click(getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('disables the close X under preventDismiss', () => {
    const onClose = vi.fn()
    const { getByRole } = render(
      <Modal open onClose={onClose} title="Saving" header preventDismiss>
        <div>body</div>
      </Modal>,
    )
    const x = getByRole('button', { name: 'Close' }) as HTMLButtonElement
    expect(x.disabled).toBe(true)
    fireEvent.click(x)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('renders no header by default', () => {
    const { queryByRole } = render(
      <Modal open onClose={() => {}} title="Plain">
        <div>body</div>
      </Modal>,
    )
    expect(queryByRole('heading')).toBeNull()
    expect(queryByRole('button', { name: 'Close' })).toBeNull()
  })
})
