import type { ReactNode } from 'react'
import {
  FLAT_TABLE_EYEBROW,
  TABLE_BORDER,
  TABLE_HEADER_BG,
  TABLE_RADIUS,
  TABLE_STRONG_DIVIDER,
  TABLE_SURFACE_BG,
} from '../components/flat-table-styles'

type Props = {
  title: string
  children: ReactNode
  /** Optional right-aligned slot in the panel header (e.g. a Notes
   *  pencil/edit button). Stays compact and aligned with the title's
   *  baseline so the header row reads as a single chrome strip. */
  headerAction?: ReactNode
}

// Notes / Weight summary panel chrome shared between the authenticated list
// detail view and the public share view. Title row + content area, with an
// optional headerAction slot on the right.
export default function PanelCard({ title, children, headerAction }: Props) {
  return (
    <div className={`${TABLE_RADIUS} ${TABLE_BORDER} ${TABLE_SURFACE_BG} overflow-hidden flex flex-col`}>
      <div className={`px-3 py-2 border-b ${TABLE_STRONG_DIVIDER} ${TABLE_HEADER_BG} flex items-center justify-between gap-2`}>
        <p className={FLAT_TABLE_EYEBROW}>{title}</p>
        {headerAction}
      </div>
      <div className="flex-1 flex flex-col">{children}</div>
    </div>
  )
}
