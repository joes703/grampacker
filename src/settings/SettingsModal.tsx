import { Download, KeyRound, Scale, TriangleAlert } from 'lucide-react'
import Modal from '../components/Modal'
import UnitSegmentedControl from '../components/UnitSegmentedControl'
import { TABLE_RADIUS, TABLE_SURFACE_BG, TABLE_STRONG_DIVIDER } from '../components/flat-table-styles'
import { passkeysSupported } from '../lib/auth-client'
import PasskeySection from './PasskeySection'
import DownloadAllData from './DownloadAllData'
import DeleteAccountSection from './DeleteAccountSection'

// Account controls, opened from the header cog.
//
// This was a /settings PAGE. Four small sections do not earn a route: reaching
// them meant leaving whatever list you were on and then navigating back, for
// things you touch a few times a year. A modal keeps your place.
//
// The route is gone rather than kept alongside. Two ways in would mean two
// sources of truth for "is settings showing", and the app's catch-all already
// sends a stale /settings bookmark to the user's most recent list.
//
// There is no "Account / change password" section: grampacker stores no
// password. Passkeys ARE the account's credentials, so the passkey section is
// the account section - it is what you manage, and the email that identifies
// you is shown there.
export default function SettingsModal({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Settings"
      // Tall content (the passkey list grows with devices) scrolls inside the
      // dialog rather than the page behind it.
      className="w-[min(42rem,calc(100vw-2rem))] max-h-[85vh]"
    >
      <div className="flex max-h-[85vh] flex-col">
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3">
          <h2 className="text-base font-semibold text-gray-900">Settings</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-sm font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900"
          >
            Done
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
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
            title="Weight units"
            subtitle="Applies to every list and your gear library. Saved on this device"
            icon={<Scale size={16} />}
          >
            <UnitSegmentedControl idPrefix="settings" />
          </Section>

          <Section
            title="Download all data"
            subtitle="A complete archive of your gear, lists, and settings"
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
      </div>
    </Modal>
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
            <h3 className={`text-base font-semibold ${danger ? 'text-red-700' : 'text-gray-900'}`}>
              {title}
            </h3>
            {subtitle && <p className="mt-0.5 text-xs text-gray-500">{subtitle}</p>}
          </div>
        </div>
      )}
      {children}
    </section>
  )
}
