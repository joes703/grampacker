import { useLocation } from 'react-router'
import { Plus } from 'lucide-react'
import MobileBottomBar from '../components/MobileBottomBar'
import { useSuppressMobilePrimaryNav } from '../layout/mobile-primary-nav-context'
import { buildMobileDestinationItems } from '../layout/mobile-nav-destinations'

type Props = {
  /** Open the "New plan" dialog. */
  onNewPlan: () => void
}

// Mobile-only bottom action bar for the Plans index. It keeps the shared
// destinations and appends the one working page action, New plan. Future
// actions do not reserve disabled slots.
export default function MobilePlanActionBar({ onNewPlan }: Props) {
  useSuppressMobilePrimaryNav()
  const { pathname } = useLocation()

  return (
    <MobileBottomBar
      label="Plans navigation and actions"
      items={[
        ...buildMobileDestinationItems(pathname),
        {
          type: 'button',
          label: 'Add',
          icon: <Plus size={18} />,
          onClick: onNewPlan,
          ariaLabel: 'New plan',
        },
      ]}
    />
  )
}
