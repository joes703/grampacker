import { ClipboardList } from 'lucide-react'
import PillToggle from '../components/PillToggle'

type Props = {
  active: boolean
  onClick: () => void
}

// The pack-mode pill toggle. One canonical component for both surfaces
// that render the control — MobilePackToggle (lg:hidden, above the
// document column) and ListDocumentToolbar (md+, next to the list name).
//
// Centralized so the label, icon, ariaLabel, and title strings can never
// drift between the two surfaces. Before this extraction, both call
// sites carried the same inline <PillToggle ... label="Pack" ...> block
// with a "do not drift" comment narrating the invariant; making the
// component shared makes the invariant structural instead of narrated.
//
// Layout (lg:hidden vs the desktop flex container with its
// ListSettingsButton sibling) stays at the call sites — those are the
// real differences and they belong where the surrounding markup lives.
export default function PackToggle({ active, onClick }: Props) {
  return (
    <PillToggle
      active={active}
      onClick={onClick}
      label="Pack"
      icon={<ClipboardList size={14} />}
      ariaLabel="Pack mode"
      title={active ? 'Pack mode: on' : 'Pack mode: off'}
    />
  )
}
