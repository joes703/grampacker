import { Download, Goal, KeyRound, Scale, TriangleAlert } from 'lucide-react'
import UnitSegmentedControl from '../components/UnitSegmentedControl'
import { TABLE_RADIUS, TABLE_SURFACE_BG, TABLE_STRONG_DIVIDER } from '../components/flat-table-styles'
import { passkeysSupported } from '../lib/auth-client'
import { useDocumentTitle } from '../lib/use-document-title'
import PasskeySection from './PasskeySection'
import DefaultTargetsSection from './DefaultTargetsSection'
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
// Weight units landed here after the deferral note below turned out to be
// false. It claimed "the g/oz control already lives on the pages + Share
// view"; it lived on the Share view ALONE, so the public share page was the
// only unit switcher in the entire product and signed-in users had to visit
// someone's shared list to change their own units. Nothing from the old app's
// six sections is deferred any more.
export default function SettingsPage() {
  useDocumentTitle('Settings')

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <h1 className="text-xl font-semibold text-gray-900">Settings</h1>

      <Section
        title="Passkeys"
        subtitle={passkeysSupported()
          ? 'Your passkeys are how you sign in. Add one per device you use'
          : 'Passkey management is unavailable in this browser'}
        icon={<KeyRound size={16} />}
      >
        <PasskeySection />
      </Section>

      <Section
        title="Default nutrition targets"
        subtitle="Copied into each new food plan; existing plans are not changed"
        icon={<Goal size={16} />}
      >
        <DefaultTargetsSection />
      </Section>

      <Section
        title="Weight units"
        subtitle="Applies to every list, your gear library, and food. Saved on this device"
        icon={<Scale size={16} />}
      >
        <UnitSegmentedControl idPrefix="settings" />
      </Section>

      <Section
        title="Download all data"
        subtitle="A complete archive of your gear, lists, food library, plans, and settings"
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

// Card shell for a settings section. The shared icon, title, and optional
// subtitle treatment keeps every card on the same hierarchy. `danger`
// switches the border/heading to the destructive palette.
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
