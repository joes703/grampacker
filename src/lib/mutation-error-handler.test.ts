import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Mutation } from '@tanstack/react-query'
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

  it('ignores a non-string errorToast', () => {
    // @ts-expect-error deliberately wrong runtime shape
    mutationErrorHandler(new Error('boom'), undefined, undefined, fakeMutation({ errorToast: 123 }))
    expect(showToast).not.toHaveBeenCalled()
  })

  // ----- structured console.warn observability branch -----
  // Moved here from optimistic.test.ts: that file's charter is the pure cache
  // lifecycle helpers (no Supabase, no logging). mutationErrorHandler is a
  // separate module, so its observability tests belong with it.

  it('logs structured warn with the mutationKey-joined prefix (Error instance)', () => {
    mutationErrorHandler(new Error('permission denied'), undefined, undefined, fakeMutation(undefined, ['gear-items', 'create']))
    expect(warnSpy).toHaveBeenCalledWith('[gear-items/create] failed', {
      error: 'permission denied',
      code: undefined,
      mutationKey: ['gear-items', 'create'],
    })
  })

  it('extracts the code property from a plain (non-Error) object payload', () => {
    // Plain objects don't go through the `error.message` branch - they're
    // stringified via String(error), which produces '[object Object]'. The
    // code property is still extracted via the typeguard. This shape is
    // unusual in practice (Supabase's PostgrestError extends Error) but
    // locks the typeguard's positive case for any future caller that
    // throws a literal object.
    const pgErrorObject = { message: 'permission denied', code: '42501' }
    mutationErrorHandler(pgErrorObject, undefined, undefined, fakeMutation(undefined, ['list-items', 'add']))
    expect(warnSpy).toHaveBeenCalledWith('[list-items/add] failed', {
      error: '[object Object]',
      code: '42501',
      mutationKey: ['list-items', 'add'],
    })
  })

  it('extracts code from an Error subclass that also carries a code property', () => {
    class PgError extends Error {
      code: string
      constructor(message: string, code: string) {
        super(message)
        this.code = code
      }
    }
    mutationErrorHandler(new PgError('row violates RLS', '42501'), undefined, undefined, fakeMutation(undefined, ['categories', 'delete']))
    expect(warnSpy).toHaveBeenCalledWith('[categories/delete] failed', {
      error: 'row violates RLS',
      code: '42501',
      mutationKey: ['categories', 'delete'],
    })
  })

  it('stringifies non-Error, non-object error values', () => {
    mutationErrorHandler('plain string error', undefined, undefined, fakeMutation(undefined, ['lists', 'reorder']))
    expect(warnSpy).toHaveBeenCalledWith('[lists/reorder] failed', {
      error: 'plain string error',
      code: undefined,
      mutationKey: ['lists', 'reorder'],
    })
  })

  it("falls back to '[mutation] failed' prefix when mutationKey is unset", () => {
    mutationErrorHandler(new Error('boom'), undefined, undefined, fakeMutation(undefined, undefined))
    expect(warnSpy).toHaveBeenCalledWith('[mutation] failed', {
      error: 'boom',
      code: undefined,
      mutationKey: undefined,
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
