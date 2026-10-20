import { Settings2 } from 'lucide-react'
import type { List } from '../lib/types'
import KebabMenu, { type KebabTriggerProps } from '../components/KebabMenu'
import ListSettingsPanel from './ListSettingsPanel'

// The labeled toolbar trigger. Hoisted because KebabMenu's `trigger` must be
// a stable component, not an inline closure, or it remounts every render.
function OptionsTrigger({ ref, onClick, open }: Omit<KebabTriggerProps, 'disabled'>) {
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      title="List options"
      aria-label="List options"
      aria-expanded={open}
      className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-500 hover:bg-gray-50"
    >
      <Settings2 size={14} />
      <span className="hidden sm:inline">List options</span>
    </button>
  )
}

// Popover trigger for current-list settings and Sharing. On /lists, sharing
// is reached from the per-row kebab's Share entry (modal + PrivacyPanel);
// this is the in-list-detail entrypoint where sharing lives inside List
// options. The panel goes through the shared KebabMenu shell - the same
// anchor/dismiss semantics as every other popover, which also gives it the
// viewport flip/clamp the old hand-anchored version lacked.
export default function ListSettingsButton({ list }: { list: List }) {
  return (
    <KebabMenu
      width={80}
      contentClassName="p-3"
      ariaLabel="List options"
      menuLabel="List options"
      trigger={OptionsTrigger}
    >
      {() => <ListSettingsPanel list={list} />}
    </KebabMenu>
  )
}
