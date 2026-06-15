import { Link } from 'react-router'

type Active = 'gear' | 'food' | 'pack'

// Shared workspace tabs for a list workspace.
export default function ListWorkspaceTabs({ listId, active }: { listId: string; active: Active }) {
  const tabs: { key: Active; label: string; to: string }[] = [
    { key: 'gear', label: 'Gear list', to: `/lists/${listId}` },
    { key: 'food', label: 'Food plan', to: `/lists/${listId}/food` },
    { key: 'pack', label: 'Pack', to: `/lists/${listId}/pack` },
  ]
  return (
    <nav className="flex gap-1 border-b border-gray-200">
      {tabs.map((t) => (
        <Link
          key={t.key}
          to={t.to}
          aria-current={active === t.key ? 'page' : undefined}
          className={
            active === t.key
              ? 'border-b-2 border-emerald-600 px-3 py-2 text-sm font-semibold text-gray-900'
              : 'border-b-2 border-transparent px-3 py-2 text-sm font-medium text-gray-500 hover:text-gray-700'
          }
        >
          {t.label}
        </Link>
      ))}
    </nav>
  )
}
