type Props = { className?: string }

// Owner-facing "Draft" pill (indicator). Shown on every list surface where a
// draft list appears: /lists cards, the desktop list rail, and the detail
// header (where it is wrapped in a button to mark the list complete). Complete
// lists render no badge. Amber to read as "in progress"; matches the
// GearStatusBadge pill grammar.
export default function DraftBadge({ className = '' }: Props) {
  return (
    <span className={`inline-flex items-center rounded-full bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800 ${className}`.trim()}>
      Draft
    </span>
  )
}
