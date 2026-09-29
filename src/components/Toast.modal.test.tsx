// @vitest-environment jsdom
import { StrictMode } from 'react'
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { render, cleanup, act, screen } from '@testing-library/react'
import Modal from './Modal'
import ToastViewport from './Toast'
import { dismissToast, getToasts, showToast } from '../lib/toast'

// A toast rendered outside an open modal <dialog> is painted behind it and
// inert, so while one is open ToastViewport must render inside the topmost one
// (src/lib/toast-host.ts). jsdom paints nothing, so these tests pin WHERE the
// region renders; that it is then visible and dismissable is browser behavior.
//
// jsdom has no showModal()/close(). Unlike Modal.test.tsx's shim, close() here
// QUEUES its `close` event, as browsers do, so the tests see the gap between
// the dialog closing and handleClose running.
const originalShowModal = HTMLDialogElement.prototype.showModal
const originalClose = HTMLDialogElement.prototype.close

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function () {
    if (!this.open) return
    this.removeAttribute('open')
    setTimeout(() => this.dispatchEvent(new Event('close')), 0)
  }
})

afterAll(() => {
  HTMLDialogElement.prototype.showModal = originalShowModal
  HTMLDialogElement.prototype.close = originalClose
})

afterEach(() => {
  cleanup()
  for (const toast of getToasts()) dismissToast(toast.id)
})

type ModalSpec = { title: string; open: boolean; preventDismiss?: boolean }

function Harness({ modals }: { modals: ModalSpec[] }) {
  return (
    <>
      {modals.map((m) => (
        <Modal key={m.title} open={m.open} onClose={() => {}} title={m.title} preventDismiss={m.preventDismiss}>
          <p>{m.title} body</p>
        </Modal>
      ))}
      <ToastViewport />
    </>
  )
}

function region(): HTMLElement {
  const el = document.querySelector<HTMLElement>('[role="status"][aria-live="polite"]')
  if (!el) throw new Error('toast region not rendered')
  return el
}

// The aria-label of the dialog the region renders in, or null for the app root.
function hostTitle(): string | null {
  return region().closest('dialog')?.getAttribute('aria-label') ?? null
}

// By selector, not role: a closed <dialog> is out of the accessibility tree.
function dialog(title: string): HTMLDialogElement {
  const el = document.querySelector<HTMLDialogElement>(`dialog[aria-label="${title}"]`)
  if (!el) throw new Error(`no dialog ${title}`)
  return el
}

async function flushCloseEvents() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

describe('ToastViewport over an open Modal', () => {
  it('renders in the app root with no modal open, empty region included', () => {
    render(<Harness modals={[]} />)
    expect(hostTitle()).toBeNull()
    expect(region().childElementCount).toBe(0)
  })

  it('renders inside the open modal, including a toast raised while it is open', () => {
    render(<Harness modals={[{ title: 'A', open: true }]} />)
    expect(hostTitle()).toBe('A')
    act(() => {
      showToast("Couldn't confirm.", { type: 'error' })
    })
    expect(screen.getByText("Couldn't confirm.").closest('dialog')).toBe(dialog('A'))
  })

  it('moves back to the app root as soon as `open` flips false, before the queued close event', () => {
    const { rerender } = render(<Harness modals={[{ title: 'A', open: true }]} />)
    act(() => {
      showToast('Still here')
    })
    rerender(<Harness modals={[{ title: 'A', open: false }]} />)
    expect(hostTitle()).toBeNull()
    expect(screen.getByText('Still here').closest('dialog')).toBeNull()
  })

  it('follows a native close (Escape, backdrop) that the parent has not re-rendered for', async () => {
    render(<Harness modals={[{ title: 'A', open: true }]} />)
    act(() => {
      dialog('A').close()
    })
    await flushCloseEvents()
    expect(hostTitle()).toBeNull()
  })

  it('keeps the host of a dialog reopened before its queued close event lands', async () => {
    render(<Harness modals={[{ title: 'A', open: true }]} />)
    act(() => {
      dialog('A').close()
      dialog('A').showModal()
    })
    await flushCloseEvents()
    expect(hostTitle()).toBe('A')
  })

  it('renders in the most recently opened of nested modals, and falls back when it closes', () => {
    const { rerender } = render(<Harness modals={[{ title: 'A', open: true }, { title: 'B', open: false }]} />)
    rerender(<Harness modals={[{ title: 'A', open: true }, { title: 'B', open: true }]} />)
    expect(hostTitle()).toBe('B')
    rerender(<Harness modals={[{ title: 'A', open: true }, { title: 'B', open: false }]} />)
    expect(hostTitle()).toBe('A')
  })

  it('follows a preventDismiss reopen back to the top, as the top layer does', async () => {
    render(<Harness modals={[{ title: 'A', open: true, preventDismiss: true }, { title: 'B', open: true }]} />)
    expect(hostTitle()).toBe('B')
    act(() => {
      dialog('A').close()
    })
    await flushCloseEvents()
    expect(dialog('A').open).toBe(true)
    expect(hostTitle()).toBe('A')
  })

  it('moves back to the app root when an open modal unmounts', () => {
    const { rerender } = render(<Harness modals={[{ title: 'A', open: true }]} />)
    rerender(<Harness modals={[]} />)
    expect(hostTitle()).toBeNull()
  })

  it('under StrictMode, modals opened in one commit keep their showModal() order', () => {
    render(
      <StrictMode>
        <Harness modals={[{ title: 'A', open: true }, { title: 'B', open: true }]} />
      </StrictMode>,
    )
    expect(hostTitle()).toBe('B')
  })
})
