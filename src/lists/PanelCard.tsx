import type { ReactNode } from 'react'
import {
  TABLE_BORDER,
  TABLE_HEADER_BG,
  TABLE_RADIUS,
  TABLE_STRONG_DIVIDER,
  TABLE_SURFACE_BG,
} from '../components/flat-table-styles'

// Notes / Weight summary panel chrome shared between the authenticated list
// detail view and the public share view. Title row + content area.
export default function PanelCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className={`${TABLE_RADIUS} ${TABLE_BORDER} ${TABLE_SURFACE_BG} overflow-hidden flex flex-col`}>
      <div className={`px-3 py-2 border-b ${TABLE_STRONG_DIVIDER} ${TABLE_HEADER_BG}`}>
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{title}</p>
      </div>
      <div className="flex-1 flex flex-col">{children}</div>
    </div>
  )
}
