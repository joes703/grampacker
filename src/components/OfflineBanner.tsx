import { WifiOff } from 'lucide-react'
import { useOnline } from '../lib/use-online'

// Slim full-width strip that surfaces "you're offline" without taking over
// the page. Mounted at the shell level (AppShell, SharePage). Renders
// nothing when online — no DOM, no listeners removed, just the
// useSyncExternalStore subscription stays alive in the hook.
//
// Deliberately NOT trying to communicate per-query freshness, last-synced
// timestamps, or recovery hints — those would each require state we don't
// have today. The banner answers exactly one question: "is the network
// down right now?" If we later need to tell the user that a particular
// list hasn't been opened offline before, that's a separate empty-state.
export default function OfflineBanner() {
  const online = useOnline()
  if (online) return null
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center justify-center gap-2 bg-amber-50 px-4 py-1.5 text-xs font-medium text-amber-800 border-b border-amber-200"
    >
      <WifiOff size={12} aria-hidden="true" />
      <span>Offline — showing the last copy you opened.</span>
    </div>
  )
}
