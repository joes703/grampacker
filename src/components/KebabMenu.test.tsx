// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import KebabMenu, { type KebabTriggerProps } from './KebabMenu'
import { RowMenuItem } from './RowMenuItem'

function CustomTrigger({ ref, onClick, open, disabled }: KebabTriggerProps) {
  return (
    <button ref={ref} type="button" onClick={onClick} aria-expanded={open} disabled={disabled}>
      Options
    </button>
  )
}

// jsdom doesn't implement <dialog>.showModal()/.close(), which the
// mobileModal branch reaches through Modal. Same shim as Modal.test.tsx.
HTMLDialogElement.prototype.showModal = function showModal() {
  this.open = true
}
HTMLDialogElement.prototype.close = function close() {
  this.open = false
}

afterEach(() => {
  cleanup()
})

function renderMenu(extra: Partial<React.ComponentProps<typeof KebabMenu>> = {}) {
  const onAction = vi.fn()
  render(
    <KebabMenu ariaLabel="Item options" menuLabel="Item actions" {...extra}>
      {({ close }) => (
        <RowMenuItem
          icon={<span />}
          onClick={() => {
            close()
            onAction()
          }}
        >
          Do thing
        </RowMenuItem>
      )}
    </KebabMenu>,
  )
  return { onAction }
}

describe('KebabMenu', () => {
  it('opens on trigger click, closes after an item runs, and re-opens', () => {
    const { onAction } = renderMenu()
    const trigger = screen.getByRole('button', { name: 'Item options' })
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')

    const menu = screen.getByRole('group', { name: 'Item actions' })
    expect(menu).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Do thing' }))
    expect(onAction).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('group', { name: 'Item actions' })).toBeNull()

    fireEvent.click(trigger)
    expect(screen.getByRole('group', { name: 'Item actions' })).toBeTruthy()
  })

  it('a second trigger click toggles the menu closed', () => {
    renderMenu()
    const trigger = screen.getByRole('button', { name: 'Item options' })
    fireEvent.click(trigger)
    fireEvent.click(trigger)
    expect(screen.queryByRole('group', { name: 'Item actions' })).toBeNull()
  })

  it('a trigger click does not activate a clickable ancestor row', () => {
    const onRowClick = vi.fn()
    render(
      <div onClick={onRowClick}>
        <KebabMenu ariaLabel="Item options" menuLabel="Item actions">
          {() => null}
        </KebabMenu>
      </div>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Item options' }))
    expect(onRowClick).not.toHaveBeenCalled()
  })

  it('mobileModal renders the items inside the options modal instead of a popover', () => {
    renderMenu({ mobileModal: true })
    fireEvent.click(screen.getByRole('button', { name: 'Item options' }))
    // Modal chrome (dialog + heading) instead of the anchored group.
    expect(screen.getByRole('heading', { name: 'Item actions' })).toBeTruthy()
    expect(screen.queryByRole('group', { name: 'Item actions' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Do thing' })).toBeTruthy()
  })

  it('a custom trigger component swaps the trigger but keeps the shared menu', () => {
    render(
      <KebabMenu
        ariaLabel="unused"
        menuLabel="Gear options"
        width={64}
        disabled={false}
        trigger={CustomTrigger}
      >
        {() => <div>panel body</div>}
      </KebabMenu>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Options' }))
    expect(screen.getByRole('group', { name: 'Gear options' })).toBeTruthy()
    expect(screen.getByText('panel body')).toBeTruthy()
  })
})
