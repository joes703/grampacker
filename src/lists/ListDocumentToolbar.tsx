import { ClipboardList } from 'lucide-react'
import type { List } from '../lib/types'
import CurrentListHeader from './CurrentListHeader'
import ListSettingsButton from './ListSettingsButton'
import PillToggle from '../components/PillToggle'

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
export default function ListDocumentToolbar({ list, packMode, onTogglePackMode }: Props) {
  return (
    <div className="hidden md:flex items-center gap-2 print:hidden">
      <CurrentListHeader list={list} />
      <div className="ml-auto flex items-center gap-2">
        <PillToggle
          active={packMode}
          onClick={onTogglePackMode}
          label="Pack"
          icon={<ClipboardList size={14} />}
          ariaLabel="Pack mode"
          title={packMode ? 'Pack mode: on' : 'Pack mode: off'}
        />
        <ListSettingsButton list={list} />
      </div>
    </div>
  )
}
