import { useState } from 'react'
import { Backpack, CheckSquare, ListChecks, Plus, Settings2 } from 'lucide-react'
import MobileOptionsModal from '../components/MobileOptionsModal'
import MobileBottomBar from '../components/MobileBottomBar'
import GearOptionsContent from './GearOptionsContent'

type Props = {
  /** Open the canonical "New item" dialog. */
  onNewItem: () => void
  /** Toggle selection mode. Active state styles the Select pill blue. */
  selectMode: boolean
  onToggleSelectMode: () => void
  /** Gear Options modal handlers — rare/utility actions. */
  onNewCategory: () => void
  onImport: () => void
  onExport: () => void
  canExport: boolean
  onCollapseAll: () => void
  onExpandAll: () => void
  canCollapseExpand: boolean
}

// Mobile-only bottom action bar for Gear Library. Mirrors the layout
// model used by MobileListActionBar on List Detail: top bar holds
// orientation (route heading + global menu), content holds browse/filter
// (search + chips), and the three primary actions live at the bottom
// (New, Select, Options). Rare actions (New category, Import, Export,
// Collapse/Expand all) hide behind the Options modal so the content
// header stays uncluttered. The Options body is GearOptionsContent —
// shared with GearOptionsButton's desktop popover so both surfaces
// stay in lockstep without duplicated row markup.
//
// Visibility:
//   - lg:hidden so desktop's inline toolbar continues to own the
//     equivalent affordances. The bar also hides in print.
//   - Renders only on /gear because it's mounted by GearLibraryPage; no
//     route gating needed.
//
// Selection-mode behavior:
//   - The Select button is a toggle: tapping enters select mode (blue
//     active style), tapping again exits. Bulk actions (move, delete,
//     create list from selection) still live in BulkActionsToolbar.
export default function MobileGearActionBar({
  onNewItem,
  selectMode,
  onToggleSelectMode,
  onNewCategory,
  onImport,
  onExport,
  canExport,
  onCollapseAll,
  onExpandAll,
  canCollapseExpand,
}: Props) {
  const [optionsOpen, setOptionsOpen] = useState(false)

  return (
    <>
      <MobileBottomBar
        label="Gear navigation and actions"
        items={[
          {
            type: 'link',
            to: '/lists',
            label: 'Lists',
            icon: <ListChecks size={18} />,
            ariaLabel: 'Lists',
          },
          {
            type: 'link',
            to: '/gear',
            label: 'Gear',
            icon: <Backpack size={18} />,
            ariaLabel: 'Gear',
          },
          {
            type: 'button',
            label: 'New',
            icon: <Plus size={18} />,
            onClick: onNewItem,
            ariaLabel: 'New gear item',
          },
          {
            type: 'button',
            label: 'Select',
            icon: <CheckSquare size={18} />,
            onClick: onToggleSelectMode,
            active: selectMode,
            ariaLabel: selectMode ? 'Exit selection mode' : 'Enter selection mode',
            ariaPressed: selectMode,
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
