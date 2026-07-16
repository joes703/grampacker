import { useLocation } from 'react-router'
import { Plus, Settings2 } from 'lucide-react'
import MobileBottomBar from '../components/MobileBottomBar'
import { useSuppressMobilePrimaryNav } from '../layout/mobile-primary-nav-context'
import { buildMobileDestinationItems } from '../layout/mobile-nav-destinations'

type Props = {
  /** Open the "New plan" dialog. */
  onNewPlan: () => void
}

// Mobile-only bottom action bar for the Plans index. Same standardized shape as
// MobileFoodActionBar (Gear / Food / Lists / Add / Options); it exists so the
// index has a working mobile Add rather than falling back to MobilePrimaryNav's
// disabled buttons. Options stays disabled until a plans slice needs it.
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
        {
          type: 'button',
          label: 'Options',
          icon: <Settings2 size={18} />,
          onClick: () => {},
          disabled: true,
          ariaLabel: 'Plan options (no action yet)',
        },
      ]}
    />
  )
}
