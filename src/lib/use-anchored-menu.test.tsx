// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createPortal } from 'react-dom'
import { fireEvent, render } from '@testing-library/react'
import { useAnchoredMenu } from './use-anchored-menu'

function Harness({ triggerTop, menuHeight }: { triggerTop: number; menuHeight: number }) {
  const { open, openMenu, triggerRef, menuRef, menuPos } =
    useAnchoredMenu({ variant: 'right-flush', menuWidth: 192 })

  return (
    <>
      <button ref={triggerRef} data-testid="trigger" data-trigger-top={triggerTop} onClick={openMenu}>
        open
      </button>
      {open && menuPos && 'left' in menuPos && createPortal(
        <div
          ref={menuRef}
          data-testid="menu"
          data-menu-height={menuHeight}
          data-trigger-top={triggerTop}
          style={{ position: 'fixed', top: menuPos.top, left: menuPos.left }}
        >
          menu
        </div>,
        document.body,
      )}
    </>
  )
}

const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect

beforeEach(() => {
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 200 })
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 400 })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this instanceof HTMLElement && this.dataset.testid === 'trigger') {
      const top = Number(this.dataset.triggerTop ?? 160)
      return {
        x: 280,
        y: top,
        top,
        bottom: top + 20,
        left: 280,
        right: 300,
        width: 20,
        height: 20,
        toJSON: () => {},
      }
    }
    if (this instanceof HTMLElement && this.dataset.testid === 'menu') {
      const height = Number(this.dataset.menuHeight ?? 120)
      return {
        x: 108,
        y: 0,
        top: 0,
        bottom: height,
        left: 108,
        right: 300,
        width: 192,
        height,
        toJSON: () => {},
      }
    }
    return originalGetBoundingClientRect.call(this)
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('useAnchoredMenu', () => {
  it('flips above the trigger when the menu would clip below the viewport', () => {
    const { getByTestId } = render(<Harness triggerTop={160} menuHeight={120} />)

    fireEvent.click(getByTestId('trigger'))

    expect(getByTestId('menu').style.top).toBe('36px')
    expect(getByTestId('menu').style.left).toBe('108px')
  })

  it('keeps the menu below the trigger when there is room', () => {
    const { getByTestId } = render(<Harness triggerTop={20} menuHeight={80} />)

    fireEvent.click(getByTestId('trigger'))

    expect(getByTestId('menu').style.top).toBe('44px')
    expect(getByTestId('menu').style.left).toBe('108px')
  })
})
