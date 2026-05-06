// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { useRef, type RefObject } from 'react'
import { render, act } from '@testing-library/react'
import { usePortalPopover } from './use-portal-popover'

// Mounts the hook against two real DOM elements (trigger, content) so the
// containedness checks (`triggerRef.current?.contains(target)` etc.) work
// against real Node identity rather than mocked refs.
function Harness(opts: {
  isOpen: boolean
  onClose: () => void
  closeOnScroll?: boolean
  closeOnResize?: boolean
  closeOnEscape?: boolean
}) {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  usePortalPopover({
    isOpen: opts.isOpen,
    onClose: opts.onClose,
    triggerRef: triggerRef as RefObject<HTMLElement | null>,
    contentRef: contentRef as RefObject<HTMLElement | null>,
    closeOnScroll: opts.closeOnScroll,
    closeOnResize: opts.closeOnResize,
    closeOnEscape: opts.closeOnEscape,
  })
  return (
    <>
      <button ref={triggerRef} data-testid="trigger">trigger</button>
      <div ref={contentRef} data-testid="content">content</div>
    </>
  )
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('usePortalPopover', () => {
  it('closes on outside mousedown', () => {
    const onClose = vi.fn()
    render(<Harness isOpen={true} onClose={onClose} />)

    act(() => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does not close on mousedown inside the trigger', () => {
    const onClose = vi.fn()
    const { getByTestId } = render(<Harness isOpen={true} onClose={onClose} />)

    act(() => {
      getByTestId('trigger').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })

    expect(onClose).not.toHaveBeenCalled()
  })

  it('does not close on mousedown inside the content', () => {
    const onClose = vi.fn()
    const { getByTestId } = render(<Harness isOpen={true} onClose={onClose} />)

    act(() => {
      getByTestId('content').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })

    expect(onClose).not.toHaveBeenCalled()
  })

  it('closes on Escape when closeOnEscape is true (default)', () => {
    const onClose = vi.fn()
    render(<Harness isOpen={true} onClose={onClose} />)

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does not close on Escape when closeOnEscape is false', () => {
    const onClose = vi.fn()
    render(<Harness isOpen={true} onClose={onClose} closeOnEscape={false} />)

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })

    expect(onClose).not.toHaveBeenCalled()
  })

  it('closes on window scroll when closeOnScroll is true (default)', () => {
    const onClose = vi.fn()
    render(<Harness isOpen={true} onClose={onClose} />)

    act(() => {
      window.dispatchEvent(new Event('scroll'))
    })

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does not close on window scroll when closeOnScroll is false', () => {
    const onClose = vi.fn()
    render(<Harness isOpen={true} onClose={onClose} closeOnScroll={false} />)

    act(() => {
      window.dispatchEvent(new Event('scroll'))
    })

    expect(onClose).not.toHaveBeenCalled()
  })

  it('closes on window resize when closeOnResize is true (default)', () => {
    const onClose = vi.fn()
    render(<Harness isOpen={true} onClose={onClose} />)

    act(() => {
      window.dispatchEvent(new Event('resize'))
    })

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does not close on window resize when closeOnResize is false', () => {
    const onClose = vi.fn()
    render(<Harness isOpen={true} onClose={onClose} closeOnResize={false} />)

    act(() => {
      window.dispatchEvent(new Event('resize'))
    })

    expect(onClose).not.toHaveBeenCalled()
  })
})
