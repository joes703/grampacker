import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Mutation } from '@tanstack/react-query'
import { mutationErrorHandler } from './mutation-error-handler'
import { showToast } from './toast'

vi.mock('./toast', () => ({ showToast: vi.fn() }))

function fakeMutation(meta?: { errorToast?: string }, mutationKey?: string[]) {
  return { options: { mutationKey, meta } } as unknown as Mutation<unknown, unknown, unknown>
}

describe('mutationErrorHandler', () => {
  beforeEach(() => {
    vi.mocked(showToast).mockClear()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

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

  it('still logs to console.warn regardless of meta', () => {
    mutationErrorHandler(new Error('boom'), undefined, undefined, fakeMutation({ errorToast: 'x' }))
    expect(console.warn).toHaveBeenCalled()
  })
})
