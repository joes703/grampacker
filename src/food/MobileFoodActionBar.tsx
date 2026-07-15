import { useLocation } from 'react-router'
import { Plus, Settings2 } from 'lucide-react'
import MobileBottomBar from '../components/MobileBottomBar'
import { useSuppressMobilePrimaryNav } from '../layout/mobile-primary-nav-context'
import { buildMobileDestinationItems } from '../layout/mobile-nav-destinations'

type Props = {
  /** Open the "New food" dialog. */
  onNewFood: () => void
}

// Mobile-only bottom action bar for the Food page. Standardized shape
// (Gear / Food / Lists / Add / Options) shared with every other mobile bar.
//
// Without a page-specific bar, /food would fall back to MobilePrimaryNav,
// whose Add and Options render as REAL disabled buttons - so the page ships
// its own bar with a working Add. Options stays disabled in slice 1: its
// contents (CSV format / Import / Export) arrive with the food CSV slice
// (slice 6). It becomes a real menu then.
export default function MobileFoodActionBar({ onNewFood }: Props) {
  useSuppressMobilePrimaryNav()
  const { pathname } = useLocation()

  return (
    <MobileBottomBar
      label="Food navigation and actions"
      items={[
        ...buildMobileDestinationItems(pathname),
        {
          type: 'button',
          label: 'Add',
          icon: <Plus size={18} />,
          onClick: onNewFood,
          ariaLabel: 'New food',
        },
        {
          type: 'button',
          label: 'Options',
          icon: <Settings2 size={18} />,
          onClick: () => {},
          disabled: true,
          ariaLabel: 'Food options (no action yet)',
        },
      ]}
    />
  )
}
