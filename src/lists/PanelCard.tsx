import type { ReactNode } from 'react'

// Notes / Weight summary panel chrome shared between the authenticated list
// detail view and the public share view. Title row + content area.
export default function PanelCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden flex flex-col">
      <div className="px-3 py-2 border-b border-gray-200 bg-gray-50">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{title}</p>
      </div>
      <div className="flex-1 flex flex-col">{children}</div>
    </div>
  )
}
