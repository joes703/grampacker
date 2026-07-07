import { ConsoleEmailSender } from './console'
import { ResendEmailSender } from './resend'

export type AuthEmail = {
  to: string
  subject: string
  html: string
  text: string
}

// All outbound email goes through this interface (portability rule 3, same
// pattern as the DB factory). The Worker uses Resend's HTTP API; a Node
// deployment or a provider change swaps the implementation, not the callers.
export interface EmailSender {
  send(msg: AuthEmail): Promise<void>
}

// Local dev runs without a Resend key and logs emails to the console -
// verification/reset URLs are copy-pasteable from `npm run dev` output.
export function createEmailSender(env: Env): EmailSender {
  if (env.RESEND_API_KEY) {
    return new ResendEmailSender(env.RESEND_API_KEY, env.EMAIL_FROM)
  }
  return new ConsoleEmailSender()
}
