import PackToggle from './PackToggle'

type Props = {
  packMode: boolean
  onTogglePackMode: () => void
}

// Mobile placement of the pack-mode toggle (lg:hidden). Sits near the top
// of the list page so the toggle stays visible without scrolling. Desktop
// equivalent lives in ListDocumentToolbar alongside list identity.
//
// Pack mode is URL state on a list (?mode=pack), not a separate
// destination — it belongs on the list page itself, not in the global
// mobile bottom bar. The pill itself (icon, label, ariaLabel, title) is
// owned by PackToggle so this surface and the desktop one can never
// drift.
export default function MobilePackToggle({ packMode, onTogglePackMode }: Props) {
  return (
    <div className="lg:hidden flex items-center print:hidden">
      <PackToggle active={packMode} onClick={onTogglePackMode} />
    </div>
  )
}
