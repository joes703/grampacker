import { useState } from 'react'
import { useLocation } from 'react-router'
import { Plus, Settings2 } from 'lucide-react'
import MobileOptionsModal from '../components/MobileOptionsModal'
import MobileBottomBar from '../components/MobileBottomBar'
import GearOptionsContent from './GearOptionsContent'
import { useSuppressMobilePrimaryNav } from '../layout/mobile-primary-nav-context'
import { buildMobileDestinationItems } from '../layout/mobile-nav-destinations'

type Props = {
  /** Open the canonical "New item" dialog. */
  onNewItem: () => void
  /** Gear Options modal handlers — rare/utility actions. */
  onNewCategory: () => void
  onImport: () => void
  onExport: () => void
  canExport: boolean
  onCollapseAll: () => void
  onExpandAll: () => void
  canCollapseExpand: boolean
}

// Mobile-only bottom action bar for the Gear page. Standardized 4-slot
// shape (Gear / Lists / Add / Options) shared with every other mobile
// bar so users see consistent geography across the app.
//
// The Select toggle used to live here as a fifth slot, but that broke
// the uniform shape and was the gear-only outlier on the bar. Select is
// now a pill on the gear page header instead — same visibility, better
// discovery on every viewport, no bar inconsistency. Rare/utility
// actions (New category, Import, Export, Collapse/Expand all) stay
// behind Options. The Options body is GearOptionsContent — shared with
// GearOptionsButton's desktop popover so both surfaces stay in lockstep
// without duplicated row markup.
//
// Visibility:
//   - lg:hidden inside MobileBottomBar so desktop never renders.
//   - Renders only on /gear because it's mounted by GearLibraryPage.
export default function MobileGearActionBar({
  onNewItem,
  onNewCategory,
  onImport,
  onExport,
  canExport,
  onCollapseAll,
  onExpandAll,
  canCollapseExpand,
}: Props) {
  useSuppressMobilePrimaryNav()
  const { pathname } = useLocation()
  const [optionsOpen, setOptionsOpen] = useState(false)

  return (
    <>
      <MobileBottomBar
        label="Gear navigation and actions"
        items={[
          ...buildMobileDestinationItems(pathname),
          {
            type: 'button',
            label: 'Add',
            icon: <Plus size={18} />,
            onClick: onNewItem,
            ariaLabel: 'New gear item',
          },
          {
            type: 'button',
            label: 'Options',
            icon: <Settings2 size={18} />,
            onClick: () => setOptionsOpen(true),
            ariaLabel: 'Gear options',
          },
        ]}
      />

      <MobileOptionsModal
        open={optionsOpen}
        onClose={() => setOptionsOpen(false)}
        title="Gear options"
      >
        <GearOptionsContent
          onNewCategory={onNewCategory}
          onImport={onImport}
          onExport={onExport}
          canExport={canExport}
          onCollapseAll={onCollapseAll}
          onExpandAll={onExpandAll}
          canCollapseExpand={canCollapseExpand}
          onAction={() => setOptionsOpen(false)}
        />
      </MobileOptionsModal>
    </>
  )
}
