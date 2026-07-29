import { useState } from 'react'
import { useLocation } from 'react-router'
import { Plus, Settings2 } from 'lucide-react'
import type { List } from '../lib/types'
import { useSidebarDrawer } from '../layout/sidebar-drawer-context'
import { useSuppressMobilePrimaryNav } from '../layout/mobile-primary-nav-context'
import { buildMobileDestinationItems } from '../layout/mobile-nav-destinations'
import MobileOptionsModal from '../components/MobileOptionsModal'
import MobileBottomBar from '../components/MobileBottomBar'
import ListSettingsPanel from './ListSettingsPanel'
import type { ListDetailMode } from './list-detail-mode'

type MobileBottomBarItem = Parameters<typeof MobileBottomBar>[0]['items'][number]

type Props = {
  /** Resolved list for the current route. When null (lists query still
   *  cold-loading), the Options button stays disabled because the modal
   *  body needs a List row to wire mutations to. Add is drawer-driven
   *  and remains enabled. */
  list: List | null
  mode: ListDetailMode
}

// Mobile-only bottom action bar for List Detail. Edit uses destinations plus
// Add and Options. Pack keeps Add but drops list-admin Options: rename,
// share, export and delete are not things you do mid-pack, and pack's own
// controls live inline in PackingProgress and on each section.
//
// Pack mode used to live as a fifth slot here, but pack is URL state on
// a list (/lists/:id/pack), not a global destination — it would have
// forced either a 5-slot inconsistent shape or a confusing
// always-grayed Add in pack mode. The list view navigation now lives inline on
// the list page itself, which also keeps Add
// available mid-pack so the "I forgot water filter" flow is one tap.
//
// Visibility: this component is only rendered by ListDetailPage's authed
// branch, so it's automatically scoped away from Gear, Lists, Settings,
// Help, and the public /r/:slug share view.
export default function MobileListActionBar({ list, mode }: Props) {
  useSuppressMobilePrimaryNav()
  const { pathname } = useLocation()
  const drawer = useSidebarDrawer()
  const [settingsOpen, setSettingsOpen] = useState(false)

  const items: MobileBottomBarItem[] = buildMobileDestinationItems(pathname)
  // Add is available in both views. It used to be suppressed in Organize,
  // where adding gear was outside that view's one job; Pack absorbed Organize
  // and Pack has always kept Add, so the "I forgot the water filter" flow
  // stays one tap from anywhere on the list.
  items.push({
    type: 'button',
    label: 'Add',
    icon: <Plus size={18} />,
    onClick: () => drawer.setOpen(true),
    disabled: !drawer.available,
    ariaLabel: 'Add gear to list',
  })
  if (mode === 'edit') {
    items.push({
      type: 'button',
      label: 'Options',
      icon: <Settings2 size={18} />,
      onClick: () => setSettingsOpen(true),
      disabled: !list,
      ariaLabel: 'List options',
    })
  }

  return (
    <>
      <MobileBottomBar label="List navigation and actions" items={items} />

      {list && mode === 'edit' && (
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
