// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reportFailure } from './report-failure'
import { showToast } from './toast'

vi.mock('./toast', () => ({ showToast: vi.fn() }))

const MESSAGE = "Couldn't confirm that."

beforeEach(() => vi.mocked(showToast).mockClear())
afterEach(() => { document.body.innerHTML = '' })

function mount(html: string): HTMLElement {
  document.body.innerHTML = html
  return document.getElementById('anchor')!
}

describe('reportFailure', () => {
  it('reports inline from a panel on the page', () => {
    const inline = vi.fn()
    reportFailure(mount('<div id="anchor"></div>'), MESSAGE, inline)
    expect(inline).toHaveBeenCalledWith(MESSAGE)
    expect(showToast).not.toHaveBeenCalled()
  })

  it('reports inline from inside an open dialog', () => {
    const inline = vi.fn()
    reportFailure(mount('<dialog open><div id="anchor"></div></dialog>'), MESSAGE, inline)
    expect(inline).toHaveBeenCalledWith(MESSAGE)
    expect(showToast).not.toHaveBeenCalled()
  })

  it('toasts from inside a closed dialog, which keeps its children mounted', () => {
    const inline = vi.fn()
    reportFailure(mount('<dialog><div id="anchor"></div></dialog>'), MESSAGE, inline)
    expect(inline).not.toHaveBeenCalled()
    expect(showToast).toHaveBeenCalledWith(MESSAGE, { type: 'error' })
  })

  it('toasts when the panel has unmounted', () => {
    const inline = vi.fn()
    const detached = mount('<div id="anchor"></div>')
    detached.remove()
    reportFailure(detached, MESSAGE, inline)
    reportFailure(null, MESSAGE, inline)
    expect(inline).not.toHaveBeenCalled()
    expect(showToast).toHaveBeenCalledTimes(2)
  })
})
