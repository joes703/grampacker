import type { ReactNode } from 'react'
import { NavLink } from 'react-router'

type BaseItem = {
  label: string
  icon: ReactNode
  ariaLabel?: string
}

type LinkItem = BaseItem & {
  type: 'link'
  to: string
  active?: boolean
}

type ButtonItem = BaseItem & {
  type: 'button'
  onClick: () => void
  active?: boolean
  disabled?: boolean
  ariaPressed?: boolean
}

export type MobileBottomBarItem = LinkItem | ButtonItem

type Props = {
  label: string
  items: MobileBottomBarItem[]
}

// Shared mobile bottom bar. Primary app navigation and page-local actions
// use the same shell so mobile pages don't drift into unrelated button styles.
export default function MobileBottomBar({ label, items }: Props) {
  return (
    <nav
      aria-label={label}
      className="lg:hidden fixed bottom-0 left-0 right-0 z-40 border-t border-gray-200 bg-white pb-[env(safe-area-inset-bottom)] print:hidden"
    >
      <div className="mx-auto flex h-14 max-w-7xl items-stretch px-2">
        {items.map((item) => {
          if (item.type === 'link') {
            return (
              <NavLink
                key={`${item.type}:${item.to}:${item.label}`}
                to={item.to}
                aria-label={item.ariaLabel ?? item.label}
                className={({ isActive }) => itemClass(item.active ?? isActive, false)}
              >
                {item.icon}
                <span>{item.label}</span>
              </NavLink>
            )
          }

          return (
            <button
              key={`${item.type}:${item.label}`}
              type="button"
              onClick={item.onClick}
              disabled={item.disabled}
              aria-label={item.ariaLabel ?? item.label}
              aria-pressed={item.ariaPressed}
              className={itemClass(Boolean(item.active), Boolean(item.disabled))}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}

function itemClass(active: boolean, disabled: boolean) {
  return `flex flex-1 flex-col items-center justify-center gap-0.5 rounded-lg px-2 text-xs font-medium ${
    active ? 'text-blue-700' : 'text-gray-600 hover:bg-gray-50'
  } ${disabled ? 'opacity-40 hover:bg-transparent' : ''}`
}
