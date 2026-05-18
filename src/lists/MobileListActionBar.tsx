import { useState } from 'react'
import { useSearchParams } from 'react-router'
import { ClipboardList, Plus, Settings2 } from 'lucide-react'
import type { List } from '../lib/types'
import { useSidebarDrawer } from '../layout/sidebar-drawer-context'
import MobileOptionsModal from '../components/MobileOptionsModal'
import ListSettingsPanel from './ListSettingsPanel'

type Props = {
  /** Resolved list for the current route. When null (lists query still
   *  cold-loading), the Options button stays disabled because the modal
   *  body needs a List row to wire mutations to. Pack and Add are URL-/
   *  context-driven and remain enabled. */
  list: List | null
}

// Mobile-only bottom action bar for List Detail. Hosts the three primary
// list actions (Add, Pack, Options) so the top bar can stay focused on
// orientation: list name + selector + global menu. Hidden at lg+ where
// every action has an inline desktop equivalent (Pack pill,
// ListSettingsButton popover, the always-mounted LibraryPanel aside).
//
// Visibility: this component is only rendered by ListDetailPage's authed
// branch, so it's automatically scoped away from Gear Inventory, All
// lists, Settings, Help, and the public /r/:slug share view. Pack mode
// keeps it visible — Add stays useful for mid-pack additions and Options
// is the same modal, so there's no surprise.
//
// State distribution:
//   - Pack toggle reads/writes ?mode=pack on the URL (single source of
//     truth used elsewhere on the page).
//   - Drawer (gear picker) open/close lives in the SidebarDrawerProvider
//     context, same one NavBar used previously.
//   - List options modal is owned here so NavBar can stay clean. The
//     ListSettingsPanel mutations are list-scoped and don't depend on
//     the action bar's lifecycle.
export default function MobileListActionBar({ list }: Props) {
  const drawer = useSidebarDrawer()
  const [searchParams, setSearchParams] = useSearchParams()
  const isPackMode = searchParams.get('mode') === 'pack'
  const [settingsOpen, setSettingsOpen] = useState(false)

  function togglePackMode() {
    setSearchParams(
      (prev) => {
        const np = new URLSearchParams(prev)
        if (isPackMode) np.delete('mode')
        else np.set('mode', 'pack')
        return np
      },
      { replace: false },
    )
  }

  return (
    <>
      <nav
        aria-label="List actions"
        // pb-[env(safe-area-inset-bottom)] respects iOS home-indicator
        // safe area on phones. print:hidden so the bar doesn't show in
        // a printed list. z-40 keeps it above the page but below
        // modals/portals (z-50).
        className="lg:hidden fixed bottom-0 left-0 right-0 z-40 border-t border-gray-200 bg-white pb-[env(safe-area-inset-bottom)] print:hidden"
      >
        <div className="mx-auto flex h-14 max-w-7xl items-stretch px-2">
          <BarButton
            label="Add"
            icon={<Plus size={18} />}
            onClick={() => drawer.setOpen(true)}
            disabled={!drawer.available}
            ariaLabel="Add gear to list"
          />
          <BarButton
            label="Pack"
            icon={<ClipboardList size={18} />}
            onClick={togglePackMode}
            active={isPackMode}
            ariaLabel="Pack mode"
            ariaPressed={isPackMode}
          />
          <BarButton
            label="Options"
            icon={<Settings2 size={18} />}
            onClick={() => setSettingsOpen(true)}
            disabled={!list}
            ariaLabel="List options"
          />
        </div>
      </nav>

      {list && (
        <MobileOptionsModal
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          title="List options"
        >
          <ListSettingsPanel list={list} />
        </MobileOptionsModal>
      )}
    </>
  )
}

function BarButton({
  label,
  icon,
  onClick,
  active = false,
  disabled = false,
  ariaLabel,
  ariaPressed,
}: {
  label: string
  icon: React.ReactNode
  onClick: () => void
  active?: boolean
  disabled?: boolean
  ariaLabel: string
  ariaPressed?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-pressed={ariaPressed}
      className={`flex flex-1 flex-col items-center justify-center gap-0.5 rounded-lg px-2 text-xs font-medium ${
        active
          ? 'text-blue-700'
          : 'text-gray-600 hover:bg-gray-50'
      } disabled:opacity-40 disabled:hover:bg-transparent`}
    >
      {icon}
      <span>{label}</span>
    </button>
  )
}
