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

type MobileBottomBarItem = Parameters<typeof MobileBottomBar>[0]['items'][number]

type Props = {
  /** Resolved list for the current route. When null (lists query still
   *  cold-loading), the Options button stays disabled because the modal
   *  body needs a List row to wire mutations to. Add is drawer-driven
   *  and remains enabled. */
  list: List | null
  /** Pack mode suppresses the Options slot. Pack-mode controls live
   *  inline at the top of PackingProgress; the rest of List options
   *  (Group worn, Sharing, lifecycle actions) is list-admin not needed
   *  during a pack pass. The bar shrinks from 4 slots to 3 in pack mode
   *  — same pattern as how Add stays available mid-pack even though Pack
   *  isn't a destination slot. */
  packMode: boolean
}

// Mobile-only bottom action bar for List Detail. Standardized 4-slot
// shape (Gear / Lists / Add / Options) shared with every other mobile
// bar so users see the same buttons in the same places everywhere.
//
// Pack mode used to live as a fifth slot here, but pack is URL state on
// a list (?mode=pack), not a separate destination — it would have
// forced either a 5-slot inconsistent shape or a confusing
// always-grayed Add in pack mode. The Pack toggle now lives inline on
// the list page itself (MobilePackToggle), which also keeps Add
// available mid-pack so the "I forgot water filter" flow is one tap.
//
// Visibility: this component is only rendered by ListDetailPage's authed
// branch, so it's automatically scoped away from Gear, Lists, Settings,
// Help, and the public /r/:slug share view.
export default function MobileListActionBar({ list, packMode }: Props) {
  useSuppressMobilePrimaryNav()
  const { pathname } = useLocation()
  const drawer = useSidebarDrawer()
  const [settingsOpen, setSettingsOpen] = useState(false)

  const items: MobileBottomBarItem[] = [
    ...buildMobileDestinationItems(pathname),
    {
      type: 'button',
      label: 'Add',
      icon: <Plus size={18} />,
      onClick: () => drawer.setOpen(true),
      disabled: !drawer.available,
      ariaLabel: 'Add gear to list',
    },
  ]
  if (!packMode) {
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

      {list && !packMode && (
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
