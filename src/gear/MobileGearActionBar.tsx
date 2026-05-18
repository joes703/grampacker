import { useState } from 'react'
import {
  CheckSquare,
  ChevronsDownUp,
  ChevronsUpDown,
  Download,
  FolderPlus,
  Plus,
  Settings2,
  Upload,
} from 'lucide-react'
import MobileOptionsModal from '../components/MobileOptionsModal'

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
// header stays uncluttered.
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
      <nav
        aria-label="Gear actions"
        // pb-[env(safe-area-inset-bottom)] respects iOS home-indicator
        // safe area on phones. print:hidden so the bar doesn't show in
        // a printed page. z-40 keeps it above the page but below
        // modals/portals (z-50).
        className="lg:hidden fixed bottom-0 left-0 right-0 z-40 border-t border-gray-200 bg-white pb-[env(safe-area-inset-bottom)] print:hidden"
      >
        <div className="mx-auto flex h-14 max-w-7xl items-stretch px-2">
          <BarButton
            label="New"
            icon={<Plus size={18} />}
            onClick={onNewItem}
            ariaLabel="New gear item"
          />
          <BarButton
            label="Select"
            icon={<CheckSquare size={18} />}
            onClick={onToggleSelectMode}
            active={selectMode}
            ariaLabel={selectMode ? 'Exit selection mode' : 'Enter selection mode'}
            ariaPressed={selectMode}
          />
          <BarButton
            label="Options"
            icon={<Settings2 size={18} />}
            onClick={() => setOptionsOpen(true)}
            ariaLabel="Gear options"
          />
        </div>
      </nav>

      {/* Gear options modal — hosts the rare/utility actions. Each row
          closes the modal as part of its handler so the user lands
          straight in the action (e.g. New category opens its own input
          row in the page header). */}
      <MobileOptionsModal
        open={optionsOpen}
        onClose={() => setOptionsOpen(false)}
        title="Gear options"
      >
        <div className="space-y-1">
          <OptionRow
            icon={<FolderPlus size={16} />}
            label="New category"
            onClick={() => {
              setOptionsOpen(false)
              onNewCategory()
            }}
          />
          <OptionRow
            icon={<Upload size={16} />}
            label="Import from CSV"
            onClick={() => {
              setOptionsOpen(false)
              onImport()
            }}
          />
          <OptionRow
            icon={<Download size={16} />}
            label="Export to CSV"
            onClick={() => {
              setOptionsOpen(false)
              onExport()
            }}
            disabled={!canExport}
          />
          <div className="my-2 border-t border-gray-100" />
          <OptionRow
            icon={<ChevronsDownUp size={16} />}
            label="Collapse all categories"
            onClick={() => {
              setOptionsOpen(false)
              onCollapseAll()
            }}
            disabled={!canCollapseExpand}
          />
          <OptionRow
            icon={<ChevronsUpDown size={16} />}
            label="Expand all categories"
            onClick={() => {
              setOptionsOpen(false)
              onExpandAll()
            }}
            disabled={!canCollapseExpand}
          />
        </div>
      </MobileOptionsModal>
    </>
  )
}

function BarButton({
  label,
  icon,
  onClick,
  active = false,
  ariaLabel,
  ariaPressed,
}: {
  label: string
  icon: React.ReactNode
  onClick: () => void
  active?: boolean
  ariaLabel: string
  ariaPressed?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      aria-pressed={ariaPressed}
      className={`flex flex-1 flex-col items-center justify-center gap-0.5 rounded-lg px-2 text-xs font-medium ${
        active ? 'text-blue-700' : 'text-gray-600 hover:bg-gray-50'
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  )
}

function OptionRow({
  icon,
  label,
  onClick,
  disabled = false,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:hover:bg-transparent"
    >
      <span className="text-gray-500">{icon}</span>
      <span>{label}</span>
    </button>
  )
}
