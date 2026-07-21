import { ClipboardList } from 'lucide-react'
import PillToggle from '../components/PillToggle'

type Props = {
  active: boolean
  onClick: () => void
}

// The pack-mode pill toggle. ListModeToggles composes it with the peer
// Organize mode on every list-detail surface.
//
// Centralized so the label, icon, ariaLabel, and title strings cannot drift
// between the responsive list toolbar and organizer header surfaces.
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
