import { PackageOpen } from 'lucide-react'
import PillToggle from '../components/PillToggle'

type Props = {
  active: boolean
  onClick: () => void
}

export default function OrganizeToggle({ active, onClick }: Props) {
  return (
    <PillToggle
      active={active}
      onClick={onClick}
      label="Organize"
      icon={<PackageOpen size={14} />}
      ariaLabel="Organize mode"
      title={active ? 'Organize mode: on' : 'Organize mode: off'}
    />
  )
}
