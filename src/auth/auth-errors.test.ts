import { describe, expect, it } from 'vitest'
import { authErrorMessage } from './auth-errors'

describe('authErrorMessage', () => {
  it('maps 429 to the rate limit copy regardless of server message', () => {
    expect(authErrorMessage({ status: 429, message: 'Too many requests' }, 'x')).toBe(
      'Too many attempts. Please wait a bit and try again.',
    )
  })

  it('prefers the server message when present', () => {
    expect(
      authErrorMessage({ status: 401, message: 'Invalid email or password' }, 'x'),
    ).toBe('Invalid email or password')
  })

  it('falls back when there is no message', () => {
    expect(authErrorMessage({ status: 500 }, 'Sign-in failed')).toBe('Sign-in failed')
    expect(authErrorMessage({ status: 400, message: '' }, 'Sign-in failed')).toBe(
      'Sign-in failed',
    )
  })

  it('falls back when there is no error object at all', () => {
    expect(authErrorMessage(null, 'Something went wrong')).toBe('Something went wrong')
  })
})
