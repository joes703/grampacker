import { Download, TriangleAlert } from 'lucide-react'
import { TABLE_RADIUS, TABLE_SURFACE_BG, TABLE_STRONG_DIVIDER } from '../components/flat-table-styles'
import { useDocumentTitle } from '../lib/use-document-title'
import PasskeySection from './PasskeySection'
import DownloadAllData from './DownloadAllData'
import DeleteAccountSection from './DeleteAccountSection'

// Account/settings hub, reached from the header cog. Restores the old
// app's /settings surface: the new app has no home page (/ redirects to
// the most-recent list via RootRedirect), so this is where account-level
// controls live.
//
// There is no "Account / change password" section: grampacker stores no
// password. Passkeys ARE the account's credentials, so the passkey section is
// the account section - it is what you manage, and the email that identifies
// you is shown there.
//
// Still deferred from the old app's six sections:
//   - Display / weight units ........ the g/oz control already lives on the
//                                     pages + Share view
//   - Default nutrition targets ..... returns with the food slice
export default function SettingsPage() {
  useDocumentTitle('Settings')

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <h1 className="text-xl font-semibold text-gray-900">Settings</h1>

      {/* PasskeySection brings its own heading + description, so it sits in
          a bare card (Section with no title row) rather than a titled
          Section. */}
      <Section>
        <PasskeySection />
      </Section>

      <Section
        title="Download all data"
        subtitle="A zip with your gear library and one CSV per list"
        icon={<Download size={16} />}
      >
        <DownloadAllData />
      </Section>

      <Section
        title="Delete account"
        subtitle="Permanently remove your account and all of its data"
        icon={<TriangleAlert size={16} />}
        danger
      >
        <DeleteAccountSection />
      </Section>
    </div>
  )
}

// Card shell for a settings section. Titled form (icon + title + optional
// subtitle) for headless content; pass no title to get just the card
// (used for PasskeySection, which supplies its own heading). `danger`
// switches the border/heading to the destructive palette. Ported from the
// old SettingsPage's Section; exported for the slices that follow.
export function Section({
  id,
  title,
  subtitle,
  icon,
  danger,
  children,
}: {
  id?: string
  title?: string
  subtitle?: string
  icon?: React.ReactNode
  danger?: boolean
  children: React.ReactNode
}) {
  return (
    <section
      id={id}
      className={`${TABLE_RADIUS} border ${TABLE_SURFACE_BG} p-5 ${
        danger ? 'border-red-200' : TABLE_STRONG_DIVIDER
      }`}
    >
      {title && (
        <div className="flex items-start gap-2 mb-4">
          {icon && <span className="mt-0.5 text-gray-500">{icon}</span>}
          <div>
            <h2 className={`text-base font-semibold ${danger ? 'text-red-700' : 'text-gray-900'}`}>
              {title}
            </h2>
            {subtitle && <p className="mt-0.5 text-xs text-gray-500">{subtitle}</p>}
          </div>
        </div>
      )}
      {children}
    </section>
  )
}
