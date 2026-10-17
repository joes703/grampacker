import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConsoleEmailSender, outbox } from './console'
import { createEmailSender } from './index'
import { ResendEmailSender } from './resend'
import type { AppEnv } from '../env'

// Which sender a configuration selects. The rule under test: the console
// sender - which prints a redeemable magic-link URL and reports success - is
// reachable ONLY from a local-dev origin. Everywhere else a missing key must
// fail the send, never fall back. Pure selection logic, so Node tier; the
// HTTP-level proof against the real magic-link endpoint is in
// server/auth-error-logging.test.ts.

// The generated AppEnv types BETTER_AUTH_URL as the production literal; the
// selection rule is about its VALUE, so the fixtures are cast.
function envWith(overrides: Record<string, string | undefined>): AppEnv {
  return {
    BETTER_AUTH_SECRET: 'x'.repeat(40),
    EMAIL_FROM: 'grampacker <no-reply@grampacker.app>',
    ...overrides,
  } as unknown as AppEnv
}

const local = 'http://localhost:5173'
const prod = 'https://grampacker.app'

describe('createEmailSender', () => {
  let consoleLog: ReturnType<typeof vi.spyOn>
  let outboxBefore: number

  beforeEach(() => {
    consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {})
    outboxBefore = outbox.length
  })

  afterEach(() => {
    consoleLog.mockRestore()
  })

  it('uses Resend whenever a key is present, on any origin', () => {
    for (const url of [local, prod]) {
      expect(
        createEmailSender(envWith({ BETTER_AUTH_URL: url, RESEND_API_KEY: 're_test' })),
      ).toBeInstanceOf(ResendEmailSender)
    }
  })

  it('uses the console sender on localhost with no key', () => {
    expect(createEmailSender(envWith({ BETTER_AUTH_URL: local }))).toBeInstanceOf(
      ConsoleEmailSender,
    )
  })

  it.each([
    ['no key on the production origin', envWith({ BETTER_AUTH_URL: prod })],
    ['an empty key on the production origin', envWith({ BETTER_AUTH_URL: prod, RESEND_API_KEY: '' })],
    ['no key on a production origin', envWith({ BETTER_AUTH_URL: 'https://example.com' })],
    ['no key and a malformed origin', envWith({ BETTER_AUTH_URL: 'not a url' })],
  ])('fails the send closed with %s', async (_label, env) => {
    const sender = createEmailSender(env)
    expect(sender).not.toBeInstanceOf(ConsoleEmailSender)
    const message = {
      to: 'someone@example.com',
      subject: 'Sign in',
      text: 'https://grampacker.app/auth/magic#token=SECRET-TOKEN',
      html: '',
    }
    await expect(sender.send(message)).rejects.toThrow(/not configured/)
    // Nothing printed, nothing recorded: the failure is the whole behavior.
    expect(consoleLog).not.toHaveBeenCalled()
    expect(outbox.length).toBe(outboxBefore)
  })
})
