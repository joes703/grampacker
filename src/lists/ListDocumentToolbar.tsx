import type { List } from '../lib/types'
import CurrentListHeader from './CurrentListHeader'
import ListSettingsButton from './ListSettingsButton'
import PackToggle from './PackToggle'

type Props = {
  list: List
  packMode: boolean
  onTogglePackMode: () => void
}

// Desktop list-document toolbar (md+). Anchors list identity and
// list-scoped actions to the document column on /lists/:id now that the
// global top bar is global-only. Mobile keeps the list name in NavBar's
// route heading and the Pack toggle in MobilePackToggle.
// Hidden in print: the print-only header carries the list name on paper.
//
// Pack mode suppresses List options. Pack-mode-specific controls
// (Show unpacked only, Add ready checks) live inline at the top of
// PackingProgress; the remaining List options (Group worn, Sharing,
// Rename/Duplicate/Export/Delete) are list-admin concerns the user
// doesn't need while actively packing, so the button isn't shown.
export default function ListDocumentToolbar({ list, packMode, onTogglePackMode }: Props) {
  return (
    <div className="hidden md:flex items-center gap-2 print:hidden">
      <CurrentListHeader list={list} />
      <div className="ml-auto flex items-center gap-2">
        <PackToggle active={packMode} onClick={onTogglePackMode} />
        {!packMode && <ListSettingsButton list={list} />}
      </div>
    </div>
  )
}
