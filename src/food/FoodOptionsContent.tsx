import { Download, Upload } from 'lucide-react'

type Props = {
  onImport: () => void
  onExport: () => void
  canExport: boolean
  /** Optional callback fired before each action runs so the parent
   *  (desktop popover or mobile modal) can dismiss itself first. */
  onAction?: () => void
}

// Shared option-list body for the Food page's "Options" surface. Consumed
// by MobileFoodActionBar's modal and by FoodOptionsButton's desktop popover
// so the rare/utility actions live in one place (the GearOptionsContent
// pattern). Each row fires `onAction()` (dismiss host) then the handler.
export default function FoodOptionsContent({
  onImport,
  onExport,
  canExport,
  onAction,
}: Props) {
  function run(fn: () => void) {
    return () => {
      onAction?.()
      fn()
    }
  }
  return (
    <div role="group" aria-label="Food options" className="space-y-1">
      <OptionRow icon={<Upload size={16} />} label="Import from CSV" onClick={run(onImport)} />
      <OptionRow
        icon={<Download size={16} />}
        label="Export to CSV"
        onClick={run(onExport)}
        disabled={!canExport}
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
      className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:hover:bg-transparent"
    >
      <span className="text-gray-500">{icon}</span>
      <span>{label}</span>
    </button>
  )
}
