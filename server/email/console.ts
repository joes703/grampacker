import type { AuthEmail, EmailSender } from './index'

export class ConsoleEmailSender implements EmailSender {
  async send(msg: AuthEmail): Promise<void> {
    console.log(`[email:dev] to=${msg.to} subject=${msg.subject}\n${msg.text}`)
  }
}
