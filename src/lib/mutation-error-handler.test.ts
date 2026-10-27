import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Mutation } from '@tanstack/react-query'
import { ApiError } from './api'
import { mutationErrorHandler } from './mutation-error-handler'
import { showToast } from './toast'

vi.mock('./toast', () => ({ showToast: vi.fn() }))

function fakeMutation(meta?: { errorToast?: string }, mutationKey?: readonly unknown[]) {
  return { options: { mutationKey, meta } } as unknown as Mutation<unknown, unknown, unknown>
}

describe('mutationErrorHandler', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.mocked(showToast).mockClear()
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warnSpy.mockRestore()
  })

  // ----- toast branch (meta.errorToast) -----

  it('shows an error toast when meta.errorToast is set', () => {
    mutationErrorHandler(new Error('boom'), undefined, undefined, fakeMutation({ errorToast: 'Could not do it.' }, ['dup']))
    expect(showToast).toHaveBeenCalledWith('Could not do it.', { type: 'error' })
  })

  it('does NOT toast when meta has no errorToast', () => {
    mutationErrorHandler(new Error('boom'), undefined, undefined, fakeMutation(undefined, ['reorder']))
    expect(showToast).not.toHaveBeenCalled()
  })

  // ----- structured console.warn observability branch -----
  // These live here, not in optimistic.test.ts: that file covers only the
  // cache lifecycle helpers.

  it('logs structured warn with the mutationKey-joined prefix (Error instance)', () => {
    mutationErrorHandler(new Error('permission denied'), undefined, undefined, fakeMutation(undefined, ['gear-items', 'create']))
    expect(warnSpy).toHaveBeenCalledWith('[gear-items/create] failed', {
      error: 'permission denied',
      mutationKey: ['gear-items', 'create'],
    })
  })

  it('stringifies non-Error, non-object error values', () => {
    mutationErrorHandler('plain string error', undefined, undefined, fakeMutation(undefined, ['lists', 'reorder']))
    expect(warnSpy).toHaveBeenCalledWith('[lists/reorder] failed', {
      error: 'plain string error',
      mutationKey: ['lists', 'reorder'],
    })
  })

  it("falls back to '[mutation] failed' prefix when mutationKey is unset", () => {
    mutationErrorHandler(new Error('boom'), undefined, undefined, fakeMutation(undefined, undefined))
    expect(warnSpy).toHaveBeenCalledWith('[mutation] failed', {
      error: 'boom',
      mutationKey: undefined,
    })
  })

  it('carries the correlation id from an ApiError into the log payload', () => {
    // The join between this console line and the server log entry that
    // explains it. Without it, a client-side "Internal Server Error" and the
    // server incident behind it cannot be tied together.
    mutationErrorHandler(
      new ApiError(500, 'Internal Server Error', 'c0ffee00-dead-4bee-8888-feedfacecafe'),
      undefined,
      undefined,
      fakeMutation(undefined, ['update-list-item', 'list-1']),
    )
    expect(warnSpy).toHaveBeenCalledWith('[update-list-item/list-1] failed', {
      error: 'Internal Server Error',
      correlationId: 'c0ffee00-dead-4bee-8888-feedfacecafe',
      mutationKey: ['update-list-item', 'list-1'],
    })
  })

  it('leaves the correlation id undefined for errors that carry none', () => {
    // A 4xx is not an incident and mints no id; neither does a network failure.
    mutationErrorHandler(
      new ApiError(409, 'Conflict'),
      undefined,
      undefined,
      fakeMutation(undefined, ['reorder-pack-items', 'list-1']),
    )
    expect(warnSpy).toHaveBeenCalledWith('[reorder-pack-items/list-1] failed', {
      error: 'Conflict',
      correlationId: undefined,
      mutationKey: ['reorder-pack-items', 'list-1'],
    })
  })

  // The warn log and the toast are independent: a mutation with an errorToast
  // both warns AND toasts.
  it('still logs to console.warn even when a toast also fires', () => {
    mutationErrorHandler(new Error('boom'), undefined, undefined, fakeMutation({ errorToast: 'x' }, ['dup']))
    expect(warnSpy).toHaveBeenCalled()
    expect(showToast).toHaveBeenCalledWith('x', { type: 'error' })
  })
})
