import { NavLink } from 'react-router'

// The /food tab strip. Slice 1 ships only the Foods tab; the Plans tab
// lands beside it in slice 2 (food-planning-design.md 12.6). Kept as its own
// component so slice 2 adds one <NavLink> and nothing else moves.
//
// A single tab is deliberate, not an oversight: the design puts plans and the
// food library under one /food home with a tab strip, and slice 1 ships the
// library half. The strip is the seam the Plans tab slots into.
export default function FoodTabs() {
  return (
    <div className="mb-6 border-b border-gray-200">
      <nav className="-mb-px flex gap-4" aria-label="Food sections">
        <FoodTab to="/food" label="Foods" />
      </nav>
    </div>
  )
}

function FoodTab({ to, label }: { to: string; label: string }) {
  return (
    <NavLink
      to={to}
      end
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
