// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  saveTargetDefaultsRequestSchema,
  type SaveTargetDefaultsRequest,
  type TargetDefault,
} from '../../shared/food-plans'

const h = vi.hoisted(() => ({
  fetch: vi.fn<() => Promise<TargetDefault[]>>(),
  save: vi.fn<(body: SaveTargetDefaultsRequest) => Promise<TargetDefault[]>>(),
}))
vi.mock('../lib/use-weight-unit', () => ({
  useWeightUnit: () => ({ weightUnit: 'g' }),
}))
vi.mock('../lib/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/queries')>()
  return {
    ...actual,
    fetchTargetDefaults: h.fetch,
    saveTargetDefaults: h.save,
  }
})
import DefaultTargetsSection from './DefaultTargetsSection'

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true
  }
  HTMLDialogElement.prototype.close = function () {
    this.open = false
  }
})
afterEach(() => {
  cleanup()
  h.fetch.mockReset()
  h.save.mockReset()
})

function renderSection() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <DefaultTargetsSection />
    </QueryClientProvider>,
  )
}

describe('DefaultTargetsSection', () => {
  it('counts the stored defaults', async () => {
    h.fetch.mockResolvedValue([
      { id: 'a', metric: 'calories', mode: 'max', targetMin: null, targetMax: 3000 },
      { id: 'b', metric: 'protein', mode: 'min', targetMin: 100, targetMax: null },
    ])
    renderSection()
    expect(await screen.findByText('2 of 6 daily targets set.')).toBeInTheDocument()
  })

  it('explains the zero state', async () => {
    h.fetch.mockResolvedValue([])
    renderSection()
    expect(
      await screen.findByText(/no defaults set\. new food plans start without targets/i),
    ).toBeInTheDocument()
  })

  it('saves the FULL replacement set (edit + untouched stored row) and closes', async () => {
    h.fetch.mockResolvedValue([
      { id: 'b', metric: 'protein', mode: 'min', targetMin: 100, targetMax: null },
    ])
    h.save.mockResolvedValue([])
    renderSection()

    fireEvent.click(await screen.findByRole('button', { name: /edit defaults/i }))
    fireEvent.change(screen.getByLabelText('Calories mode'), { target: { value: 'max' } })
    fireEvent.change(screen.getByLabelText('Calories maximum'), { target: { value: '2500' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save defaults' }))

    await waitFor(() =>
      expect(h.save).toHaveBeenCalledWith({
        defaults: [
          { metric: 'calories', mode: 'max', targetMin: null, targetMax: 2500 },
          { metric: 'protein', mode: 'min', targetMin: 100, targetMax: null },
        ],
      }),
    )
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Save defaults' })).not.toBeInTheDocument(),
    )
  })

  it('omits a stored default switched to Off (full replace deletes it)', async () => {
    h.fetch.mockResolvedValue([
      { id: 'b', metric: 'protein', mode: 'min', targetMin: 100, targetMax: null },
    ])
    h.save.mockResolvedValue([])
    renderSection()

    fireEvent.click(await screen.findByRole('button', { name: /edit defaults/i }))
    fireEvent.change(screen.getByLabelText('Protein (g) mode'), { target: { value: 'off' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save defaults' }))

    await waitFor(() => expect(h.save).toHaveBeenCalledWith({ defaults: [] }))
  })

  it('emits a payload that passes the server schema, canonical density preserved', async () => {
    h.fetch.mockResolvedValue([
      { id: 'c', metric: 'calorie_density', mode: 'min', targetMin: 4.2333, targetMax: null },
    ])
    h.save.mockResolvedValue([])
    renderSection()

    fireEvent.click(await screen.findByRole('button', { name: /edit defaults/i }))
    fireEvent.change(screen.getByLabelText('Protein (g) mode'), { target: { value: 'min' } })
    fireEvent.change(screen.getByLabelText('Protein (g) minimum'), { target: { value: '100' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save defaults' }))

    await waitFor(() => expect(h.save).toHaveBeenCalled())
    const payload = h.save.mock.calls[0]![0]
    expect(saveTargetDefaultsRequestSchema.safeParse(payload).success).toBe(true)
    expect(payload.defaults.find((d) => d.metric === 'calorie_density')).toEqual({
      metric: 'calorie_density',
      mode: 'min',
      targetMin: 4.2333,
      targetMax: null,
    })
  })

  it('cannot be closed or re-entered while a save is in flight', async () => {
    h.fetch.mockResolvedValue([])
    h.save.mockReturnValue(new Promise(() => {})) // never settles
    renderSection()

    fireEvent.click(await screen.findByRole('button', { name: /edit defaults/i }))
    fireEvent.change(screen.getByLabelText('Calories mode'), { target: { value: 'max' } })
    fireEvent.change(screen.getByLabelText('Calories maximum'), { target: { value: '2500' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save defaults' }))

    await waitFor(() => expect(h.save).toHaveBeenCalled())
    // A second full-replace racing the first can leave cache and D1
    // disagreeing about which set won - every dismissal path is blocked.
    const cancel = screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement
    expect(cancel.disabled).toBe(true)
    fireEvent.click(cancel)
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeInTheDocument()
    // Escape's cancelable `cancel` event must be prevented BEFORE the native
    // dialog closes, and a force-close must reopen instead of desyncing.
    const dialog = document.querySelector('dialog')!
    expect(fireEvent(dialog, new Event('cancel', { cancelable: true }))).toBe(false)
    dialog.close()
    fireEvent(dialog, new Event('close'))
    expect(dialog.open).toBe(true)
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeInTheDocument()
    expect(
      (screen.getByRole('button', { name: /edit defaults/i }) as HTMLButtonElement).disabled,
    ).toBe(true)
  })

  it('keeps the dialog open when the save fails', async () => {
    h.fetch.mockResolvedValue([])
    h.save.mockRejectedValueOnce(new Error('nope'))
    renderSection()

    fireEvent.click(await screen.findByRole('button', { name: /edit defaults/i }))
    fireEvent.change(screen.getByLabelText('Calories mode'), { target: { value: 'max' } })
    fireEvent.change(screen.getByLabelText('Calories maximum'), { target: { value: '2500' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save defaults' }))

    await waitFor(() => expect(h.save).toHaveBeenCalled())
    expect(screen.getByLabelText('Calories maximum')).toHaveValue('2500')
  })

  it('shows an error (NOT "no defaults") and blocks editing when the load fails', async () => {
    h.fetch.mockRejectedValue(new Error('read failed'))
    renderSection()

    await screen.findByText(/couldn't load/i)
    // A failed read must never look like "no defaults set" (which would let
    // the user open an empty editor and overwrite real defaults).
    expect(screen.queryByText(/no defaults set/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /edit defaults/i })).not.toBeInTheDocument()
  })
})
