import { ClipboardList } from 'lucide-react'
import type { List } from '../lib/types'
import CurrentListHeader from './CurrentListHeader'
import ListSettingsButton from './ListSettingsButton'

type Props = {
  list: List
  packMode: boolean
  onTogglePackMode: () => void
}

// Desktop list-document toolbar (md+). Anchors list identity and
// list-scoped actions to the document column on /lists/:id now that the
// global top bar is global-only. Mobile keeps the list name in NavBar's
// route heading and the Pack / List-options actions in MobileListActionBar.
// Hidden in print: the print-only header carries the list name on paper.
export default function ListDocumentToolbar({ list, packMode, onTogglePackMode }: Props) {
  return (
    <div className="hidden md:flex items-center gap-2 print:hidden">
      <CurrentListHeader list={list} />
      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          onClick={onTogglePackMode}
          title={packMode ? 'Pack mode: on' : 'Pack mode: off'}
          aria-label="Pack mode"
          aria-pressed={packMode}
          className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium ${
            packMode
              ? 'border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100'
              : 'border-gray-300 text-gray-500 hover:bg-gray-50'
          }`}
        >
          <ClipboardList size={14} />
          <span>Pack</span>
        </button>
        <ListSettingsButton list={list} />
      </div>
    </div>
  )
}
