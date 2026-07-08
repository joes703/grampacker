import { gearStatusVisual, type GearStatus } from '../../lib/gear-status'

type Props = {
  status: GearStatus
  // Compact form hides the label and just shows the icon (used in dense
  // rows). Both forms keep the same accessible label via title/aria.
  compact?: boolean
  className?: string
}

// Renders a small badge describing a non-default gear status. Returns null
// for the default 'active' status so the call sites don't have to branch:
// `<GearStatusBadge status={g.status} />` is safe to drop in unconditionally.
export default function GearStatusBadge({ status, compact = false, className = '' }: Props) {
  const visual = gearStatusVisual(status)
  if (!visual) return null
  const Icon = visual.icon
  return (
    <span
      title={visual.label}
      aria-label={visual.label}
      className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-xs font-medium ${visual.badgeClass} ${className}`}
    >
      <Icon size={12} aria-hidden />
      {!compact && <span>{visual.label}</span>}
    </span>
  )
}
