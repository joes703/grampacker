import { ClipboardList } from 'lucide-react'
import PillToggle from '../components/PillToggle'

type Props = {
  packMode: boolean
  onTogglePackMode: () => void
}

// Mobile-only pack-mode toggle (lg:hidden). Sits near the top of the list
// page so the toggle stays visible without scrolling. Desktop equivalent
// lives in ListDocumentToolbar alongside list identity.
//
// Pack mode is URL state on a list (?mode=pack), not a separate
// destination — it belongs on the list page itself, not in the global
// mobile bottom bar. Label, ariaLabel, and title match the desktop pill
// so the two surfaces never drift; aria-pressed plus the active fill
// carry the on/off state visually and for assistive tech.
export default function MobilePackToggle({ packMode, onTogglePackMode }: Props) {
  return (
    <div className="lg:hidden flex items-center print:hidden">
      <PillToggle
        active={packMode}
        onClick={onTogglePackMode}
        label="Pack"
        icon={<ClipboardList size={14} />}
        ariaLabel="Pack mode"
        title={packMode ? 'Pack mode: on' : 'Pack mode: off'}
      />
    </div>
  )
}
