// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi, beforeAll } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { TargetDefault } from '../lib/types'

const h = vi.hoisted(() => ({
  fetch: vi.fn<(u: string) => Promise<TargetDefault[]>>(),
  save: vi.fn<(...a: unknown[]) => Promise<void>>(),
  session: { current: { user: { id: 'u1' } } as { user: { id: string } } | null },
}))
vi.mock('../lib/use-weight-unit', () => ({ useWeightUnit: () => ({ weightUnit: 'g' }) }))
vi.mock('../auth/AuthProvider', () => ({ useAuth: () => ({ session: h.session.current, loading: false }) }))
vi.mock('../lib/queries', () => ({
  queryKeys: { targetDefaults: (u: string) => ['target-defaults', u] as const },
  fetchTargetDefaults: (u: string) => h.fetch(u),
  saveTargetDefaults: (...a: unknown[]) => h.save(...a),
}))
import DefaultTargetsSection from './DefaultTargetsSection'

beforeAll(() => { HTMLDialogElement.prototype.showModal = function () { this.open = true }; HTMLDialogElement.prototype.close = function () { this.open = false } })
afterEach(() => { cleanup(); h.fetch.mockReset(); h.save.mockReset(); h.session.current = { user: { id: 'u1' } } })

function newClient() { return new QueryClient({ defaultOptions: { queries: { retry: false } } }) }
const tree = (qc: QueryClient) => <QueryClientProvider client={qc}><DefaultTargetsSection /></QueryClientProvider>

describe('DefaultTargetsSection', () => {
  it('saves edited defaults and closes the dialog', async () => {
    h.fetch.mockResolvedValue([]); h.save.mockResolvedValue(undefined)
    render(tree(newClient()))
    fireEvent.click(await screen.findByRole('button', { name: /edit defaults/i }))
    fireEvent.change(screen.getByLabelText('Calories mode'), { target: { value: 'max' } })
    fireEvent.change(screen.getByLabelText('Calories maximum'), { target: { value: '2500' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save defaults' }))
    await waitFor(() => expect(h.save).toHaveBeenCalledWith('u1', { upserts: [{ metric: 'calories', mode: 'max', target_min: null, target_max: 2500 }], deletes: [] }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Save defaults' })).not.toBeInTheDocument())
  })

  it('keeps the dialog open when the save fails', async () => {
    h.fetch.mockResolvedValue([]); h.save.mockRejectedValueOnce(new Error('nope'))
    render(tree(newClient()))
    fireEvent.click(await screen.findByRole('button', { name: /edit defaults/i }))
    fireEvent.change(screen.getByLabelText('Calories mode'), { target: { value: 'max' } })
    fireEvent.change(screen.getByLabelText('Calories maximum'), { target: { value: '2500' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save defaults' }))
    await waitFor(() => expect(h.save).toHaveBeenCalled())
    expect(screen.getByLabelText('Calories maximum')).toHaveValue('2500')
  })

  it('shows an error (NOT "no defaults") and blocks editing when the load fails', async () => {
    h.fetch.mockRejectedValue(new Error('read failed'))
    render(tree(newClient()))
    await screen.findByText(/couldn't load/i)
    // A failed read must never look like "no defaults set" (which would let the
    // user open an empty editor and overwrite real defaults).
    expect(screen.queryByText(/no defaults set/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /edit defaults/i })).not.toBeInTheDocument()
  })

  it("a user A save that resolves AFTER switching to B does not touch B's editor or cache", async () => {
    // The core guarantee of the key={userId} panel. Use a DEFERRED A save so it is
    // still in flight across the account switch.
    h.fetch.mockResolvedValue([])
    let resolveA: () => void = () => {}
    h.save.mockImplementationOnce(() => new Promise<void>((res) => { resolveA = () => res() }))
    const qc = newClient()
    const { rerender } = render(tree(qc))

    // User A: open, edit, click Save -> A's save is pending (deferred).
    fireEvent.click(await screen.findByRole('button', { name: /edit defaults/i }))
    fireEvent.change(screen.getByLabelText('Calories mode'), { target: { value: 'max' } })
    fireEvent.change(screen.getByLabelText('Calories maximum'), { target: { value: '2500' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save defaults' }))
    await waitFor(() => expect(h.save).toHaveBeenCalledWith('u1', expect.anything()))

    // Switch to user B (remounts the keyed panel) and open B's editor.
    h.session.current = { user: { id: 'u2' } }
    rerender(tree(qc))
    fireEvent.click(await screen.findByRole('button', { name: /edit defaults/i }))
    expect(screen.getByRole('button', { name: 'Save defaults' })).toBeInTheDocument()
    const bFetchCalls = h.fetch.mock.calls.filter(([u]) => u === 'u2').length

    // Now A's save resolves. Its onSuccess is bound to userId 'u1' (a no-op for B):
    // B's dialog must stay open and B's cache must NOT be invalidated/refetched.
    await act(async () => { resolveA(); await Promise.resolve() })
    expect(screen.getByRole('button', { name: 'Save defaults' })).toBeInTheDocument()
    expect(h.fetch.mock.calls.filter(([u]) => u === 'u2').length).toBe(bFetchCalls)
  })
})
