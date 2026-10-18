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

// Selection does not use the database or static assets.
function envWith(overrides: Record<string, string | undefined>): AppEnv {
  return {
    BETTER_AUTH_SECRET: 'x'.repeat(40),
    EMAIL_FROM: 'grampacker <no-reply@grampacker.app>',
    ...overrides,
  } as AppEnv
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

  it.each([
    ['configured key', { BETTER_AUTH_URL: prod, RESEND_API_KEY: 're_test' }, ResendEmailSender],
    ['local development', { BETTER_AUTH_URL: local }, ConsoleEmailSender],
    ['unconfigured public origin', { BETTER_AUTH_URL: prod }, null],
  ])('selects a sender for %s', async (_label, config, expected) => {
    const sender = createEmailSender(envWith(config))
    if (expected) {
      expect(sender).toBeInstanceOf(expected)
      return
    }
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

it('sends the supplied message to Resend with the configured credentials and sender', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
  vi.stubGlobal('fetch', fetch)
  const message = {
    to: 'backpacker@example.com',
    subject: 'Sign in',
    text: 'Synthetic sign-in text',
    html: '<p>Synthetic sign-in text</p>',
  }
  await new ResendEmailSender('re_synthetic', 'App <app@example.com>').send(message)
  expect(fetch).toHaveBeenCalledTimes(1)
  const [url, request] = fetch.mock.calls[0] as unknown as [string, RequestInit]
  expect({ url, ...request, body: JSON.parse(String(request.body)) }).toEqual({
    url: 'https://api.resend.com/emails',
    method: 'POST',
    headers: {
      Authorization: 'Bearer re_synthetic',
      'Content-Type': 'application/json',
    },
    body: { from: 'App <app@example.com>', ...message },
  })
})

afterEach(() => vi.unstubAllGlobals())
