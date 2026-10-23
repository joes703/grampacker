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

// Sharing's one home on the list detail page. It used to live inside List
// options, between Rename and Delete; both 2026-10 UX audits took three
// clicks to find it, and sharing is the end goal of building a list for this
// audience. Moved rather than copied - List options no longer hosts it - so
// there is still exactly one share surface here. The Lists page keeps its
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
