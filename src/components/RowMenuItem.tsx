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
  /** Set false when the surrounding container is NOT an ARIA menu
   *  (e.g. a settings/options panel that mixes buttons and inputs).
   *  Default true keeps the kebab popovers' menu semantics intact;
   *  setting false drops the role="menuitem" attribute so the button
   *  reads as a plain button to assistive tech. This avoids invalid
   *  ARIA when the container can hold non-menuitem children (a text
   *  input for inline rename, etc.). */
  inMenu?: boolean
}

export function RowMenuItem({
  icon,
  children,
  onClick,
  tone = 'neutral',
  inMenu = true,
}: RowMenuItemProps) {
  return (
    <button
      type="button"
      role={inMenu ? 'menuitem' : undefined}
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
