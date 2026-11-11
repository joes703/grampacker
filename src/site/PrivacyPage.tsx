import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { useDocumentTitle } from '../lib/use-document-title'
import SiteFooter, { CONTACT_EMAIL } from './SiteFooter'

// Every claim here is a promise about the code or the server. Change this
// page in the same change as the behavior it describes:
// - sessions: expiresIn in server/auth.ts; better-auth records each
//   session's IP address and user agent (IP tracking is left on)
// - sign-in attempt counts: server/middleware/rate-limit.ts
// - no third-party scripts: the CSP in server/middleware/security-headers.ts
// - one cookie: better-auth's session cookie (no cookie cache is configured)
// - backups and the 30-day promise: docs/vps-runbook.md, "Backups"
//
// Plain words and short sentences: many readers' first language is not
// English.

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-6">
      <h2 className="text-base font-semibold text-gray-900">{title}</h2>
      <div className="mt-2 space-y-2">{children}</div>
    </section>
  )
}

export default function PrivacyPage() {
  useDocumentTitle('Privacy')
  return (
    <main className="min-h-screen bg-gray-50 px-4 py-10">
      <div className="mx-auto max-w-2xl">
        <Link to="/" className="text-sm font-semibold text-gray-900 hover:underline">
          grampacker
        </Link>
        <article className="mt-4 rounded-lg border border-gray-200 bg-white p-6 text-sm text-gray-700 shadow-sm">
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">Privacy</h1>

          <Section title="What grampacker stores">
            <ul className="list-disc space-y-1 pl-5">
              <li>Your email address, to send you sign-in links.</li>
              <li>
                The public key and the name of each passkey. grampacker never
                receives the private key. It stays on your device or in your
                password manager.
              </li>
              <li>Your gear, lists, notes and settings.</li>
              <li>
                For each browser where you are signed in: its IP address, the
                browser name, and the time the session ends. A session ends when
                you sign out, or 30 days after you last used it.
              </li>
              <li>
                The number of recent sign-in requests from each IP address and
                for each email address. For the email address, only a scrambled
                form (a keyed hash) is stored. grampacker uses these numbers to
                block repeated attempts, and deletes them after about a day.
              </li>
            </ul>
          </Section>

          <Section title="Backups">
            <p>
              The database is backed up every night. Each backup is encrypted
              before it is uploaded to Backblaze B2, and backups are deleted
              after 30 days.
            </p>
          </Section>

          <Section title="Other companies that handle your data">
            <ul className="list-disc space-y-1 pl-5">
              <li>
                Resend sends the sign-in emails, so it receives your email
                address and the link.
              </li>
              <li>RackNerd rents the server that runs grampacker.</li>
              <li>Backblaze stores the encrypted backups.</li>
            </ul>
          </Section>

          <Section title="What grampacker does not do">
            <p>
              grampacker has no ads, no analytics and no tracking scripts. It
              does not sell your data. It sets one cookie, to keep you signed in.
              Your display settings, such as grams or ounces, are saved in your
              browser.
            </p>
          </Section>

          <Section title="Shared lists">
            <p>
              Anyone with the link to a shared list can read that list. This
              stops when you switch off Shared for that list.
            </p>
          </Section>

          <Section title="Your data">
            <p>
              In Settings, Download all data gives you a copy of all your data.
              Delete account deletes your account and all of its data from the
              database at once. If you delete your account, copies of your data
              can stay in backups for up to 30 days.
            </p>
          </Section>

          <p className="mt-6">
            Questions:{' '}
            <a href={`mailto:${CONTACT_EMAIL}`} className="text-blue-600 hover:underline">
              {CONTACT_EMAIL}
            </a>
          </p>
        </article>
        <SiteFooter />
      </div>
    </main>
  )
}
