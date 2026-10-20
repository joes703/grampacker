import { type ComponentType, type ReactNode, type Ref, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { MoreVertical } from 'lucide-react'
import { useAnchoredMenu } from '../lib/use-anchored-menu'
import MobileOptionsModal from './MobileOptionsModal'
import RowIconButton from './RowIconButton'
import { POPOVER_SURFACE } from './flat-table-styles'

// Tailwind scans whole class tokens, so each width is a literal class plus
// the matching pixel width useAnchoredMenu needs for right-flush anchoring.
// Add a row here before using a new width.
const WIDTHS = {
  44: { className: 'w-44', px: 176 },
  48: { className: 'w-48', px: 192 },
  56: { className: 'w-56', px: 224 },
  64: { className: 'w-64', px: 256 },
  80: { className: 'w-80', px: 320 },
} as const

export type KebabMenuContext = {
  close: () => void
  // The trigger element, for actions that need an origin to return focus or
  // anchor a follow-up surface to (MoveToLocationMenu's reorder handoff).
  // Read it BEFORE close() if the action also unmounts surrounding state.
  triggerRef: RefObject<HTMLButtonElement | null>
}

type Props = {
  /** Trigger aria-label. Unused when `trigger` is set. */
  ariaLabel: string
  /** Popover aria-label; also the title of the mobileModal variant. */
  menuLabel: string
  /** Menu items. Call ctx.close() before running an action. */
  children: (ctx: KebabMenuContext) => ReactNode
  width?: keyof typeof WIDTHS
  icon?: ReactNode
  touchSafe?: boolean
  disabled?: boolean
  title?: string
  /** Inner padding of the popover surface. Menus keep the py-1 default;
   *  panel-style content (GearOptionsButton) passes p-2. */
  contentClassName?: string
  /** Mobile escape hatch (MoveToLocationMenu's contract): render the items
   *  inside MobileOptionsModal instead of an anchored popover. The modal
   *  owns dismiss semantics there; the anchored position is unused. */
  mobileModal?: boolean
  /** Trigger escape hatch for non-kebab triggers (a header plus button, a
   *  labeled Options button). A COMPONENT, not a render prop, so the ref
   *  flows as a JSX prop (the react-hooks/refs rule forbids handing a ref
   *  through a plain function call during render). Define it at module
   *  level - an inline definition remounts the trigger every render. Wire
   *  ref and onClick onto a <button>; the anchored menu, dismiss handling
   *  and surface stay shared. */
  trigger?: ComponentType<KebabTriggerProps>
}

export type KebabTriggerProps = {
  ref: Ref<HTMLButtonElement>
  onClick: (e: React.MouseEvent) => void
  open: boolean
  // KebabMenu's own `disabled` prop, forwarded so a custom trigger can wire
  // it without closing over caller state (a per-render closure component
  // would remount the trigger - and drop its focus - on every render).
  disabled: boolean
}

// The one kebab/popover shell: RowIconButton trigger + useAnchoredMenu
// (flip/clamp + dismiss on outside mousedown, scroll, resize, escape) +
// portal-rendered POPOVER_SURFACE with role="group". Every row/section
// options menu composes this instead of re-wiring the scaffold; per-site
// differences enter only through the declared props.
export default function KebabMenu({
  ariaLabel,
  menuLabel,
  children,
  width = 48,
  icon,
  touchSafe = false,
  disabled = false,
  title,
  contentClassName = 'py-1',
  mobileModal = false,
  trigger: Trigger,
}: Props) {
  const { open, openMenu, close, triggerRef, menuRef, menuPos } =
    useAnchoredMenu({ variant: 'right-flush', menuWidth: WIDTHS[width].px })

  // The kebab usually sits inside a row whose body is itself clickable (an
  // edit button, a link); opening the menu must not also activate the row.
  function onTriggerClick(e: React.MouseEvent) {
    e.stopPropagation()
    e.preventDefault()
    if (open) close()
    else openMenu()
  }

  const ctx: KebabMenuContext = { close, triggerRef }

  return (
    <>
      {Trigger ? (
        <Trigger ref={triggerRef} onClick={onTriggerClick} open={open} disabled={disabled} />
      ) : (
        <RowIconButton
          ref={triggerRef}
          onClick={onTriggerClick}
          ariaLabel={ariaLabel}
          aria-expanded={open}
          icon={icon ?? <MoreVertical size={14} />}
          touchSafe={touchSafe}
          disabled={disabled}
          title={title}
        />
      )}
      {mobileModal && open ? (
        <MobileOptionsModal open={open} onClose={close} title={menuLabel}>
          <div ref={menuRef} className="space-y-1">
            {children(ctx)}
          </div>
        </MobileOptionsModal>
      ) : !mobileModal && open && menuPos ? (
        createPortal(
          <div
            ref={menuRef}
            role="group"
            aria-label={menuLabel}
            className={`fixed z-50 ${WIDTHS[width].className} ${contentClassName} ${POPOVER_SURFACE}`}
            style={{ top: menuPos.top, left: menuPos.left }}
          >
            {children(ctx)}
          </div>,
          document.body,
        )
      ) : null}
    </>
  )
}
