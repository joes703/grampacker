import type { ListDetailMode } from './list-detail-mode'
import OrganizeToggle from './OrganizeToggle'
import PackToggle from './PackToggle'

type Props = {
  mode: ListDetailMode
  onTogglePackMode: () => void
  onToggleOrganizeMode: () => void
}

export default function ListModeToggles({
  mode,
  onTogglePackMode,
  onToggleOrganizeMode,
}: Props) {
  return (
    <div role="group" aria-label="List mode" className="flex items-center gap-2">
      <PackToggle active={mode === 'pack'} onClick={onTogglePackMode} />
      <OrganizeToggle
        active={mode === 'organize'}
        onClick={onToggleOrganizeMode}
      />
    </div>
  )
}
