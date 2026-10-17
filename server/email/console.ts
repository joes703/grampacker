import type { AuthEmail, EmailSender } from './index'

// Emails sent on a local-dev origin with no Resend key: `npm run dev` and the
// API test suite. Tests import this to recover the magic-link token, which is
// the ONLY way to get a session now that passwords are gone - so the auth
// tests drive the real endpoint rather than seeding `verification` rows
// behind better-auth's back.
//
// Safe to keep in the bundle: ConsoleEmailSender is only constructed when
// RESEND_API_KEY is unset AND BETTER_AUTH_URL is localhost
// (server/email/index.ts), so production never writes here - a missing key
// there fails the send instead. Bounded anyway - a long-lived dev server
// should not grow a leak.
const MAX_OUTBOX = 50
export const outbox: AuthEmail[] = []

// The most recent email to an address. Tests within a file run in parallel
// against one app, so filtering by recipient is what keeps them from
// stealing each other's tokens.
export function lastEmailTo(to: string): AuthEmail | undefined {
  return outbox.findLast((msg) => msg.to === to)
}

export class ConsoleEmailSender implements EmailSender {
  async send(msg: AuthEmail): Promise<void> {
    outbox.push(msg)
    if (outbox.length > MAX_OUTBOX) outbox.shift()
    console.log(`[email:dev] to=${msg.to} subject=${msg.subject}\n${msg.text}`)
  }
}
