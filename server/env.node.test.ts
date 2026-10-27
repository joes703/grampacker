import { describe, expect, it } from 'vitest'
import { ConfigError, loadConfig } from './env'

const SECRET = 'x'.repeat(32)
const base = { BETTER_AUTH_URL: 'https://grampacker.app', BETTER_AUTH_SECRET: SECRET }

function errorFor(source: NodeJS.ProcessEnv): string {
  try {
    loadConfig(source)
  } catch (err) {
    expect(err).toBeInstanceOf(ConfigError)
    return (err as Error).message
  }
  throw new Error('expected a ConfigError')
}

describe('loadConfig', () => {
  it('fills the defaults', () => {
    expect(loadConfig(base)).toEqual({
      ...base,
      RESEND_API_KEY: undefined,
      EMAIL_FROM: 'grampacker <no-reply@grampacker.app>',
      STATIC_DIR: 'dist/client',
      DATABASE_PATH: '/data/grampacker.db',
      PORT: 3000,
      HOST: '127.0.0.1',
    })
  })

  // A variable set to an empty string (a blank line in an env file) means
  // "not set", not "set to nothing".
  it('treats empty strings as unset', () => {
    expect(
      loadConfig({
        ...base,
        RESEND_API_KEY: '',
        EMAIL_FROM: '',
        STATIC_DIR: '',
        DATABASE_PATH: '',
        HOST: '',
      }),
    ).toEqual(loadConfig(base))
  })

  it('accepts ports 0 to 65535 only', () => {
    expect(loadConfig({ ...base, PORT: '0' }).PORT).toBe(0)
    expect(loadConfig({ ...base, PORT: '65535' }).PORT).toBe(65535)
    for (const port of ['65536', '-1', '1.5', 'abc']) {
      expect(errorFor({ ...base, PORT: port }), port).toBe('PORT is not a valid port number')
    }
  })

  it('names a missing or invalid value', () => {
    expect(errorFor({ BETTER_AUTH_SECRET: SECRET })).toBe('BETTER_AUTH_URL is not set')
    expect(errorFor({ ...base, BETTER_AUTH_URL: '' })).toBe('BETTER_AUTH_URL is not set')
    expect(errorFor({ ...base, BETTER_AUTH_URL: 'not a url' })).toBe('BETTER_AUTH_URL is not a valid URL')
    expect(errorFor({ BETTER_AUTH_URL: base.BETTER_AUTH_URL })).toBe('BETTER_AUTH_SECRET is not set')
  })

  it('refuses a short secret without echoing it', () => {
    const message = errorFor({ ...base, BETTER_AUTH_SECRET: 'short-secret-value' })
    expect(message).toBe('BETTER_AUTH_SECRET must be at least 32 characters')
    expect(message).not.toContain('short-secret-value')
  })
})
