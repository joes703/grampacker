import { useState } from 'react'
import { useLocation } from 'react-router'
import { Plus, Settings2 } from 'lucide-react'
import MobileOptionsModal from '../components/MobileOptionsModal'
import MobileBottomBar from '../components/MobileBottomBar'
import FoodOptionsContent from './FoodOptionsContent'
import { useSuppressMobilePrimaryNav } from '../layout/mobile-primary-nav-context'
import { buildMobileDestinationItems } from '../layout/mobile-nav-destinations'

type Props = {
  /** Open the "New food" dialog. */
  onNewFood: () => void
  /** Food Options modal handlers - rare/utility actions. */
  onImport: () => void
  onExport: () => void
  canExport: boolean
}

// Mobile-only bottom action bar for the Food page. Standardized shape
// (Gear / Food / Lists / Add / Options) shared with every other mobile bar.
//
// Options was a disabled placeholder through slice 5; slice 6 fills it with
// the CSV actions. The Options body is FoodOptionsContent - shared with
// FoodOptionsButton's desktop popover so both surfaces stay in lockstep
// (the MobileGearActionBar pattern).
export default function MobileFoodActionBar({
  onNewFood,
  onImport,
  onExport,
  canExport,
}: Props) {
  useSuppressMobilePrimaryNav()
  const { pathname } = useLocation()
  const [optionsOpen, setOptionsOpen] = useState(false)

  return (
    <>
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
            onClick: () => setOptionsOpen(true),
            ariaLabel: 'Food options',
          },
        ]}
      />

      <MobileOptionsModal
        open={optionsOpen}
        onClose={() => setOptionsOpen(false)}
        title="Food options"
      >
        <FoodOptionsContent
          onImport={onImport}
          onExport={onExport}
          canExport={canExport}
          onAction={() => setOptionsOpen(false)}
        />
      </MobileOptionsModal>
    </>
  )
}
