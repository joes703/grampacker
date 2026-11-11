import { useState } from 'react'
import { Plus, Settings2 } from 'lucide-react'
import type { List } from '../lib/types'
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
  /** Opens the page's gear drawer. Not offered in Food. */
  onAdd: () => void
}

// Mobile-only bottom action bar for List Detail. Edit uses destinations plus
// Add and Options. The Options slot is an edit-mode shortcut, not the only
// entry point: the document toolbar's List options button renders in every
// mode and viewport, so pack and food lose nothing by not repeating it
// here. Food also drops Add: there is nothing to add gear to there, and
// ListDetailPage closes the drawer in Food.
//
// Pack mode is not a slot here: pack is URL state on a list
// (/lists/:id/pack), not a global destination. The list view navigation
// lives inline on the list page itself.
//
// Visibility: this component is only rendered by ListDetailPage's authed
// branch, so it's automatically scoped away from Gear, Lists, Settings,
// Help, and the public /r/:slug share view.
export default function MobileListActionBar({ list, mode, onAdd }: Props) {
  useSuppressMobilePrimaryNav()
  const [settingsOpen, setSettingsOpen] = useState(false)

  const items: MobileBottomBarItem[] = buildMobileDestinationItems()
  // Add is available in Edit and Pack, so the "I forgot the water filter"
  // flow stays one tap from anywhere on the list. Withheld in Food: there is
  // nothing to add gear to there.
  if (mode !== 'food') {
    items.push({
      type: 'button',
      label: 'Add',
      icon: <Plus size={18} />,
      onClick: onAdd,
      ariaLabel: 'Add gear to list',
    })
  }
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
          <ListSettingsPanel list={list} onClose={() => setSettingsOpen(false)} />
        </MobileOptionsModal>
      )}
    </>
  )
}
