import { useState } from 'react'
import { useSearchParams } from 'react-router'
import { Backpack, Boxes, ClipboardList, Plus, Settings2 } from 'lucide-react'
import type { List } from '../lib/types'
import { useSidebarDrawer } from '../layout/sidebar-drawer-context'
import MobileOptionsModal from '../components/MobileOptionsModal'
import MobileBottomBar from '../components/MobileBottomBar'
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
      <MobileBottomBar
        label="List navigation and actions"
        items={[
          {
            type: 'link',
            to: '/lists',
            label: 'Lists',
            icon: <Backpack size={18} />,
            ariaLabel: 'All lists',
          },
          {
            type: 'link',
            to: '/gear',
            label: 'Gear',
            icon: <Boxes size={18} />,
            ariaLabel: 'Gear Library',
          },
          {
            type: 'button',
            label: 'Add',
            icon: <Plus size={18} />,
            onClick: () => drawer.setOpen(true),
            disabled: !drawer.available,
            ariaLabel: 'Add gear to list',
          },
          {
            type: 'button',
            label: 'Pack',
            icon: <ClipboardList size={18} />,
            onClick: togglePackMode,
            active: isPackMode,
            ariaLabel: 'Pack mode',
            ariaPressed: isPackMode,
          },
          {
            type: 'button',
            label: 'Options',
            icon: <Settings2 size={18} />,
            onClick: () => setSettingsOpen(true),
            disabled: !list,
            ariaLabel: 'List options',
          },
        ]}
      />

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
