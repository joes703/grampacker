import { Share2 } from 'lucide-react'
import type { List } from '../lib/types'
import KebabMenu, { type KebabTriggerProps } from '../components/KebabMenu'
import PrivacyPanel from './PrivacyPanel'

// Hoisted for the same reason as ListSettingsButton's trigger: KebabMenu's
// `trigger` must be a stable component, not an inline closure, or it
// remounts every render.
function ShareTrigger({ ref, onClick, open }: Omit<KebabTriggerProps, 'disabled'>) {
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      title="Share"
      aria-label="Share"
      aria-expanded={open}
      className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-500 hover:bg-gray-50"
    >
      <Share2 size={14} />
      <span className="hidden sm:inline">Share</span>
    </button>
  )
}

// Sharing's one home on the list detail page. Sharing is the end goal of
// building a list for this audience, so it has its own toolbar button rather
// than sitting inside List options, between Rename and Delete. List options
// does not host it, so there is exactly one share surface here. The Lists
// page keeps its
// per-row Share entry (modal + the same PrivacyPanel).
export default function ListShareButton({ list }: { list: List }) {
  return (
    <KebabMenu
      width={80}
      contentClassName="p-3"
      ariaLabel="Share"
      menuLabel="Share"
      trigger={ShareTrigger}
    >
      {() => <PrivacyPanel list={list} />}
    </KebabMenu>
  )
}
