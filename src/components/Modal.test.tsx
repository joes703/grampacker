// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import { render, cleanup, fireEvent, getByText as getByTextWithin } from '@testing-library/react'
import Modal from './Modal'

// jsdom (29.x at install time) doesn't implement <dialog>.showModal() / .close().
// The Modal component drives those imperatively via a useEffect, so without
// these shims the test render either throws or leaves dialog.open === false
// regardless of the `open` prop. close() must dispatch the native 'close'
// event so React's onClose prop (delegated via the dialog's onClose listener)
// fires through the same path production uses.
beforeAll(() => {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function () {
      this.setAttribute('open', '')
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
    const { getByTestId } = render(
      <Modal open={true} onClose={onClose} title="Test">
        <div data-testid="content">content</div>
      </Modal>,
    )

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

  it('renders children inside the dialog when open', () => {
    const { container } = render(
      <Modal open={true} onClose={() => {}} title="Test">
        <div>visible content</div>
      </Modal>,
    )
    const dialog = container.querySelector('dialog')
    expect(dialog).not.toBeNull()
    // getByText throws if not found — reaching the line below means the
    // text was rendered inside the dialog. No jest-dom matcher needed.
    expect(getByTextWithin(dialog!, 'visible content').textContent).toBe('visible content')
  })
})
