import { NavLink } from 'react-router'

// The /food tab strip: the food library (Foods) and the meal plans (Plans),
// under one /food home (food-planning-design.md 12.6).
//
// Foods matches only /food exactly (`end`); Plans stays active across both the
// index (/food/plans) and any open editor (/food/plans/:id), so it does NOT use
// `end`. Without that split, opening a plan would deactivate the Plans tab.
export default function FoodTabs() {
  return (
    <div className="mb-6 border-b border-gray-200">
      <nav className="-mb-px flex gap-4" aria-label="Food sections">
        <FoodTab to="/food" label="Foods" end />
        <FoodTab to="/food/plans" label="Plans" />
      </nav>
    </div>
  )
}

function FoodTab({
  to,
  label,
  end = false,
}: {
  to: string
  label: string
  end?: boolean
}) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `border-b-2 px-1 py-2 text-sm font-medium ${
          isActive
            ? 'border-blue-600 text-blue-600'
            : 'border-transparent text-gray-500 hover:text-gray-700'
        }`
      }
    >
      {label}
    </NavLink>
  )
}
