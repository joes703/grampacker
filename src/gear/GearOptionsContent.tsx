import { ChevronsDownUp, ChevronsUpDown, Download, FolderPlus, Upload } from 'lucide-react'

type Props = {
  onNewCategory: () => void
  onImport: () => void
  onExport: () => void
  canExport: boolean
  onCollapseAll: () => void
  onExpandAll: () => void
  canCollapseExpand: boolean
  /** Optional callback fired before each action runs so the parent
   *  (desktop popover or mobile modal) can dismiss itself first. */
  onAction?: () => void
}

// Shared option-list body for the Gear page's "Options" surface. Consumed
// by MobileGearActionBar's modal and by GearOptionsButton's desktop popover
// so the rare/utility actions live in one place. Each row is an OptionRow
// that fires `onAction()` (dismiss host) then the bound handler.
export default function GearOptionsContent({
  onNewCategory,
  onImport,
  onExport,
  canExport,
  onCollapseAll,
  onExpandAll,
  canCollapseExpand,
  onAction,
}: Props) {
  function run(fn: () => void) {
    return () => {
      onAction?.()
      fn()
    }
  }
  return (
    <div role="menu" aria-label="Gear options" className="space-y-1">
      <OptionRow icon={<FolderPlus size={16} />} label="New category" onClick={run(onNewCategory)} />
      <OptionRow icon={<Upload size={16} />} label="Import from CSV" onClick={run(onImport)} />
      <OptionRow
        icon={<Download size={16} />}
        label="Export to CSV"
        onClick={run(onExport)}
        disabled={!canExport}
      />
      <div className="my-2 border-t border-gray-100" />
      <OptionRow
        icon={<ChevronsDownUp size={16} />}
        label="Collapse all categories"
        onClick={run(onCollapseAll)}
        disabled={!canCollapseExpand}
      />
      <OptionRow
        icon={<ChevronsUpDown size={16} />}
        label="Expand all categories"
        onClick={run(onExpandAll)}
        disabled={!canCollapseExpand}
      />
    </div>
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
      role="menuitem"
      className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:hover:bg-transparent"
    >
      <span className="text-gray-500">{icon}</span>
      <span>{label}</span>
    </button>
  )
}
