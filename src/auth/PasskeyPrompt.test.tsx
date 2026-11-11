// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const h = vi.hoisted(() => ({
  addPasskey: vi.fn<() => Promise<{ error: unknown } | undefined>>(),
}))

vi.mock('../lib/auth-client', () => ({
  authClient: { passkey: { addPasskey: h.addPasskey } },
}))

import PasskeyPrompt from './PasskeyPrompt'

// jsdom does not implement <dialog>.showModal() / .close(); Modal drives both
// imperatively. Same shim Modal.test.tsx documents in full.
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
  h.addPasskey.mockReset()
})

function renderPrompt() {
  const onClose = vi.fn()
  render(<PasskeyPrompt onClose={onClose} />)
  return onClose
}

const addButton = () => screen.getByRole('button', { name: 'Add a passkey' })

describe('PasskeyPrompt', () => {
  it('says what a passkey does here and where to manage them', () => {
    renderPrompt()

    expect(screen.getByRole('dialog', { name: 'Sign in faster next time' })).toBeInTheDocument()
    expect(
      screen.getByText(
        'Add a passkey to this device. Next time, you can sign in with your fingerprint, face or PIN instead of a sign-in link.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByText('You can add or remove passkeys in Settings.')).toBeInTheDocument()
  })

  it('adds a passkey and closes', async () => {
    h.addPasskey.mockResolvedValue({ error: null })
    const onClose = renderPrompt()

    fireEvent.click(addButton())

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(h.addPasskey).toHaveBeenCalledTimes(1)
  })

  it('closes on Not now without adding anything', () => {
    const onClose = renderPrompt()

    fireEvent.click(screen.getByRole('button', { name: 'Not now' }))

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(h.addPasskey).not.toHaveBeenCalled()
  })

  it('stays open with a message when the person cancels the browser dialog', async () => {
    h.addPasskey.mockRejectedValue(new DOMException('canceled', 'NotAllowedError'))
    const onClose = renderPrompt()

    fireEvent.click(addButton())

    expect(await screen.findByText('Passkey setup was canceled or failed.')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
    // They can try again.
    expect(addButton()).toBeEnabled()
  })

  it('points to Settings when the session is too old to add a passkey', async () => {
    h.addPasskey.mockResolvedValue({
      error: { status: 403, code: 'SESSION_NOT_FRESH', message: 'Session is not fresh' },
    })
    const onClose = renderPrompt()

    fireEvent.click(addButton())

    expect(
      await screen.findByText("Couldn't add the passkey here. Add one in Settings."),
    ).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('shows the server message for other errors', async () => {
    h.addPasskey.mockResolvedValue({ error: { status: 400, message: 'Bad request' } })
    renderPrompt()

    fireEvent.click(addButton())

    expect(await screen.findByText('Bad request')).toBeInTheDocument()
  })
})
