import type { ReactNode } from 'react'

// Shared row/popover menu action. Keep row menus visually consistent across
// list rows, gear rows, category headers, and the Lists page.
export type RowMenuTone = 'neutral' | 'removal' | 'danger'

const ROW_MENU_TONE_CLASS: Record<RowMenuTone, string> = {
  neutral: 'text-gray-700 hover:bg-gray-100',
  // Reversible membership action: red text, neutral hover surface.
  removal: 'text-red-700 hover:bg-gray-100',
  // Destructive action: red text and red hover surface.
  danger: 'text-red-600 hover:bg-red-50',
}

export const ROW_MENU_ITEM_BASE =
  'flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm'

type RowMenuItemProps = {
  icon: ReactNode
  children: ReactNode
  onClick: () => void
  tone?: RowMenuTone
}

export function RowMenuItem({ icon, children, onClick, tone = 'neutral' }: RowMenuItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`${ROW_MENU_ITEM_BASE} ${ROW_MENU_TONE_CLASS[tone]}`}
    >
      {icon}
      <span className="truncate">{children}</span>
    </button>
  )
}

export function RowMenuSeparator() {
  return <div className="my-1 border-t border-gray-100" />
}
