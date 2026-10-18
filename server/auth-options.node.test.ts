import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppEnv } from './env'

vi.mock('./db', () => ({ createDb: vi.fn(() => ({})) }))
vi.mock('better-auth/adapters/drizzle', () => ({ drizzleAdapter: vi.fn(() => ({})) }))
vi.mock('better-auth/plugins/magic-link', () => ({ magicLink: vi.fn(() => ({})) }))
vi.mock('@better-auth/passkey', () => ({ passkey: vi.fn(() => ({})) }))
vi.mock('better-auth/api', async (importOriginal) => ({
  ...await importOriginal<typeof import('better-auth/api')>(),
  createAuthMiddleware: vi.fn((handler) => handler),
  getSessionFromCtx: vi.fn(),
}))

import { magicLink } from 'better-auth/plugins/magic-link'
import { passkey } from '@better-auth/passkey'
import { getSessionFromCtx } from 'better-auth/api'
import { authOptions } from './auth'

// These mocks capture only our inputs to the plugin constructors. No database
// or WebAuthn ceremony is needed to exercise our configuration and callbacks.
const env = {
  BETTER_AUTH_URL: 'http://localhost:5173',
  BETTER_AUTH_SECRET: 'synthetic-auth-options-secret-at-least-32-chars',
  EMAIL_FROM: 'App <app@example.com>',
} as AppEnv

beforeEach(() => vi.clearAllMocks())

it('chooses hashed five-minute links and enables origin validation', () => {
  const options = authOptions(env)
  expect(vi.mocked(magicLink).mock.calls[0]?.[0]).toMatchObject({
    storeToken: 'hashed', expiresIn: 300,
  })
  expect(options.advanced.disableOriginCheck).toBe(false)
})

describe.each([
  ['registration', 'registrationInfo', 'BAD_REQUEST'],
  ['authentication', 'authenticationInfo', 'UNAUTHORIZED'],
] as const)('%s user verification', (ceremony, info, status) => {
  it('accepts verified results and rejects unverified results', async () => {
    authOptions(env)
    const callback = vi.mocked(passkey).mock.calls[0]?.[0]?.[ceremony]?.afterVerification
    if (!callback) throw new Error('verification callback was not supplied')
    // The callback reads only this verification result; the plugin owns the
    // remaining ceremony context and cryptographic validation.
    type Callback = (input: { verification: Record<string, { userVerified: boolean }> }) => unknown
    const verify = callback as unknown as Callback
    const args = (userVerified: boolean) => ({ verification: { [info]: { userVerified } } })
    await expect(Promise.resolve().then(() => verify(args(true)))).resolves.toBeUndefined()
    await expect(Promise.resolve().then(() => verify(args(false)))).rejects.toMatchObject({
      status, body: { code: 'USER_VERIFICATION_REQUIRED' },
    })
  })
})

it('allows sign-in, reads, and rename without a session; new passkey paths fail closed', async () => {
  const hook = authOptions(env).hooks.before
  // createAuthMiddleware is an identity mock so we exercise our hook directly.
  const run = (path: string) => hook({ path } as Parameters<typeof hook>[0])
  for (const path of [
    '/passkey/generate-authenticate-options', '/passkey/verify-authentication',
    '/passkey/list-user-passkeys', '/passkey/update-passkey',
  ]) {
    await expect(run(path)).resolves.toBeUndefined()
  }
  expect(getSessionFromCtx).not.toHaveBeenCalled()
  vi.mocked(getSessionFromCtx).mockResolvedValue(null)
  await expect(run('/passkey/future-credential-mutation')).rejects.toMatchObject({
    status: 'UNAUTHORIZED', body: { code: 'UNAUTHORIZED' },
  })
})
