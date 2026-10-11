import { isDevEnvironment } from '../middleware/security-headers'
import { ConsoleEmailSender } from './console'
import { ResendEmailSender } from './resend'
import type { AppEnv } from '../env'

export type AuthEmail = {
  to: string
  subject: string
  html: string
  text: string
}

// All outbound email goes through this interface. The server uses Resend's
// HTTP API; a provider change swaps the implementation, not the callers.
export interface EmailSender {
  send(msg: AuthEmail): Promise<void>
}

// Local dev runs without a Resend key and logs emails to the console - the
// magic-link URL is copy-pasteable from `npm run dev` output. The same sender
// records to an in-memory outbox that the API tests read (server/email/console).
//
// ONLY local dev. "Local" is isDevEnvironment's test - BETTER_AUTH_URL's
// hostname is exactly `localhost` - the same discriminator that relaxes the
// CSP, so there is one definition of dev. Anywhere else a missing key used to
// select the console sender too, which made a dropped or rotated-away
// production secret fail OPEN: sign-in reported success, sent nothing, and
// wrote redeemable magic-link URLs into Workers Logs. Now it fails at SEND
// time, as a logged 500 on the magic-link request alone. Not at construction:
// authOptions runs for every /api/auth/* request and every requireSession
// check, and a mail misconfiguration must not take down session lookups.
export function createEmailSender(env: AppEnv): EmailSender {
  if (env.RESEND_API_KEY) {
    return new ResendEmailSender(env.RESEND_API_KEY, env.EMAIL_FROM)
  }
  if (isDevEnvironment(env)) {
    return new ConsoleEmailSender()
  }
  return {
    async send(): Promise<void> {
      // No recipient or content in the message - it can end up in logs.
      throw new Error(
        'email is not configured: RESEND_API_KEY is unset and the origin is not local dev',
      )
    },
  }
}
