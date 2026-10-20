// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import { render, cleanup, fireEvent, screen } from '@testing-library/react'
import ConfirmDialog from './ConfirmDialog'

// jsdom lacks <dialog>.showModal()/.close(); same shim as Modal.test.tsx.
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

afterEach(cleanup)

describe('ConfirmDialog', () => {
  it('renders Cancel and the confirm action by default', () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(
      <ConfirmDialog title="Delete it?" message="Gone forever." onConfirm={onConfirm} onCancel={onCancel} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('the one-button variant drops Cancel for pure acknowledgements', () => {
    const onConfirm = vi.fn()
    render(
      <ConfirmDialog
        title="Import error"
        message="Bad CSV."
        confirmLabel="Close"
        cancel={false}
        messageTone="danger"
        onConfirm={onConfirm}
        onCancel={onConfirm}
      />,
    )
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })
})
