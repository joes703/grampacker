import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { SectionIdentity } from './CategoryGroup'
import { packRowId, packRowName, type PackRow } from './pack-rows'
import {
  isNoOpSlot,
  placementSlotLabel,
  visualSlotToInsertIndex,
} from './placement-plan'

// Click-to-place: the non-drag pointer path for reordering a row inside its
// bag (WCAG 2.5.7). Authenticated-only - it is imported by
// SortableCategoryRows and SortableItemRow, neither of which the public share
// view reaches.
//
// WHY A CONTEXT, and not a prop threaded through renderRows:
//
// renderRows travels inside the memoized sharedGroupProps. Making it depend on
// which row is placing would rebuild that object on entering AND leaving
// placement, so every CategoryGroup - Worn and every category included - would
// fail its shallow compare twice per placement. Context propagates through a
// memo bailout instead: React tracks consumers directly, so a mounted slot
// updates even when the section above it does not re-render.
//
// THREE contexts, not one object. A single {placement, start, cancel} value
// would be a new reference on every parent render and would notify every
// mounted slot on every checkbox tick - the exact cost the context was
// introduced to avoid. Actions and the slot registry are stable for the
// lifetime of the provider; only the state context changes.

type Placement = {
  itemId: string
  movingName: string
  /** The section the mode was STARTED from. A slot only answers to placement
   *  when its own section matches, so a row that is rehomed while the mode is
   *  open - moved from another tab, or orphaned into Unassigned when its
   *  location is deleted - takes its slots with it and the mode ends, rather
   *  than silently retargeting whatever bag the row landed in. */
  sectionKey: string
  instance: number
}

type PlacementActions = {
  /** `origin` is the control that opened the mode - the row kebab. Focus
   *  returns there when the mode closes, because the slot that had focus is
   *  about to unmount and focus would otherwise fall to the document. */
  start: (
    row: PackRow,
    section: SectionIdentity,
    origin: HTMLElement | null,
  ) => void
  /** `returnFocus: false` for callers that must NOT move focus - a drag
   *  starting while the mode is open is the case that matters, because the
   *  keyboard sensor reads its keystrokes from the focused drag handle and
   *  pulling focus to the kebab would strand the drag mid-flight. */
  cancel: (options?: { returnFocus?: boolean }) => void
  commit: (
    rowId: string,
    insertIndex: number,
    eligibleRows: readonly PackRow[],
  ) => void
}

/** Mounted-and-usable slots call this and keep the returned cleanup. See
 *  PlacementProvider for what the count is for. */
type RegisterUsableSlot = () => () => void

const PlacementStateContext = createContext<Placement | null>(null)
const PlacementActionsContext = createContext<PlacementActions | null>(null)
const PlacementRegisterContext = createContext<RegisterUsableSlot | null>(null)

/**
 * Owns the placement state. Called by the page rather than by the provider so
 * the page can drive `start`/`cancel` directly - it needs them for the row
 * menu and for the lifecycle cancellations, and a component cannot consume a
 * context it renders itself.
 */
export function usePlacement(
  onCommit: (
    rowId: string,
    insertIndex: number,
    eligibleRows: readonly PackRow[],
  ) => void,
): { placement: Placement | null; actions: PlacementActions } {
  const [placement, setPlacement] = useState<Placement | null>(null)
  const instanceRef = useRef(0)
  const originRef = useRef<HTMLElement | null>(null)
  // Kept in a ref, synced in an effect rather than during render, so the
  // actions object below can stay stable for the provider's whole lifetime
  // while the page rebuilds this callback every render.
  const onCommitRef = useRef(onCommit)
  useEffect(() => {
    onCommitRef.current = onCommit
  })

  const actions = useMemo<PlacementActions>(() => {
    // Called BEFORE the state change that unmounts the slots. React batches
    // the setState, so the DOM still holds the focused slot at this point and
    // moving focus away first means the later unmount is a no-op for focus.
    // If the kebab has gone (its row was removed, its section collapsed) we
    // leave focus alone rather than guessing at a substitute.
    const restoreFocus = () => {
      const origin = originRef.current
      originRef.current = null
      if (origin?.isConnected) origin.focus({ preventScroll: true })
    }
    return {
      start: (row, section, origin) => {
        instanceRef.current += 1
        originRef.current = origin
        setPlacement({
          itemId: packRowId(row),
          movingName: packRowName(row),
          sectionKey: section.key,
          instance: instanceRef.current,
        })
      },
      cancel: (options) => {
        if (options?.returnFocus === false) originRef.current = null
        else restoreFocus()
        setPlacement(null)
      },
      commit: (rowId, insertIndex, eligibleRows) => {
        restoreFocus()
        // Clear FIRST. The mutation is optimistic, so leaving the mode open
        // would briefly render slots against a cohort that is already moving.
        setPlacement(null)
        onCommitRef.current(rowId, insertIndex, eligibleRows)
      },
    }
  }, [])

  return { placement, actions }
}

export function PlacementProvider({
  placement,
  actions,
  children,
}: {
  placement: Placement | null
  actions: PlacementActions
  children: ReactNode
}) {
  // A mode with nothing to click is a trap: it swallows Escape-less exits and
  // leaves the user in a state with no visible affordance. It can happen after
  // the mode opens for reasons the page cannot cheaply predict - the section
  // collapses, the row is promoted to a container (a container renders as a
  // section HEADER, which has no slots), another tab moves it into a collapsed
  // bag, or its location is optimistically deleted. Rather than encoding each
  // of those as another predicate beside placingStillEligible, the slots
  // report whether any of them exist and the mode closes when none do.
  //
  // This state lives HERE and not in usePlacement on purpose. The provider
  // re-renders when the count changes, but `children` is the same element
  // object the page created on its last render, so React bails out on the
  // whole subtree. Putting the counter in the page instead would re-render
  // every section through renderPackRowAction.
  const [usableSlots, setUsableSlots] = useState(0)
  const register = useMemo<RegisterUsableSlot>(() => () => {
    setUsableSlots((n) => n + 1)
    return () => setUsableSlots((n) => n - 1)
  }, [])

  // A TRANSITION to zero, not a zero LEVEL. On the commit that opens the mode
  // the count is still 0 - the slots have not run their effects yet - and a
  // level test would cancel the mode instantly. Only a count that was once
  // positive and has since fallen to zero means the slots went away. Opening
  // with genuinely nowhere to place is prevented at the source instead: the
  // menu withholds the action when a section has fewer than two rows in it.
  const hadUsableSlotsRef = useRef(false)
  const cancel = actions.cancel
  const placing = placement !== null
  useEffect(() => {
    if (!placing) {
      hadUsableSlotsRef.current = false
      return
    }
    if (usableSlots > 0) {
      hadUsableSlotsRef.current = true
      return
    }
    if (hadUsableSlotsRef.current) cancel()
  }, [placing, usableSlots, cancel])

  return (
    <PlacementActionsContext.Provider value={actions}>
      <PlacementRegisterContext.Provider value={register}>
        <PlacementStateContext.Provider value={placement}>
          {children}
        </PlacementStateContext.Provider>
      </PlacementRegisterContext.Provider>
    </PlacementActionsContext.Provider>
  )
}

/**
 * True while this row is the one being placed. Consumed by SortableItemRow to
 * mark the row that is moving.
 *
 * It reads the context DIRECTLY from the row rather than taking a prop,
 * because a prop would have to come from CategoryGroup - which is memoized and
 * bails out, and is also on the public share path. A consumer re-renders on a
 * context change even when its parent does not, which is the whole reason
 * placement travels this way.
 */
export function useIsPlacing(itemId: string): boolean {
  return useContext(PlacementStateContext)?.itemId === itemId
}

/**
 * The mode's header: says what is moving and offers the way out.
 *
 * The way out is the point. Escape closes the mode, but a touch user has no
 * Escape key, and this whole feature exists to give pointer users what drag
 * gives everyone else (WCAG 2.5.7). Without a visible Cancel, a phone user who
 * opened the mode by accident could only reorder something or leave the page.
 *
 * ALWAYS mounted, for the same reason the slots are - see PlacementSlot.
 */
export function PlacementBanner({
  rows,
  section,
}: {
  rows: readonly PackRow[]
  section: SectionIdentity
}) {
  const placement = useContext(PlacementStateContext)
  const actions = useContext(PlacementActionsContext)
  const active =
    placement !== null &&
    placement.sectionKey === section.key &&
    rows.some((row) => packRowId(row) === placement.itemId)

  if (!active || !actions || !placement) return null

  return (
    <div
      className="flex items-center justify-between gap-2 border-b border-blue-100 bg-blue-50 px-3 py-2"
      // The mode is a state change with no page navigation, so a screen reader
      // gets no announcement from the DOM alone.
      role="status"
    >
      <span className="text-sm text-blue-900">
        Moving <span className="font-medium">{placement.movingName}</span> - pick a
        new position
      </span>
      <button
        type="button"
        className="shrink-0 rounded px-2 py-1 text-sm font-medium text-blue-700 hover:bg-blue-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        onClick={() => actions.cancel()}
      >
        Cancel
      </button>
    </div>
  )
}

/**
 * One insertion point. ALWAYS mounted, even when placement is closed.
 *
 * It cannot be rendered conditionally by its caller: renderRows runs during
 * CategoryGroup's render, so a `{placing && <Slot/>}` test would be evaluated
 * once and then frozen by the memo, and the slots would never appear. Being
 * mounted and returning null is what lets the context reach it.
 */
export function PlacementSlot({
  slot,
  rows,
  section,
}: {
  slot: number
  /** The exact array this section rendered. The plan is computed against it
   *  rather than against a rebuilt cohort - see planPlacementWithinLocation. */
  rows: readonly PackRow[]
  section: SectionIdentity
}) {
  const placement = useContext(PlacementStateContext)
  const actions = useContext(PlacementActionsContext)
  const register = useContext(PlacementRegisterContext)
  const ref = useRef<HTMLButtonElement>(null)

  // Two conditions, and both matter. The row has to be one of THIS section's
  // rendered rows - which is what makes the plan operate on the array the user
  // is actually looking at - AND this has to be the section the mode started
  // in. Without the second, a row that gets rehomed mid-placement (another tab
  // moves it, or its location is deleted and it falls into Unassigned) would
  // hand its slots to the new section and the next click would reorder a
  // cohort the user never chose.
  const inThisSection = placement !== null && placement.sectionKey === section.key
  const sourceIndex = inThisSection
    ? rows.findIndex((row) => packRowId(row) === placement.itemId)
    : -1
  const active = inThisSection && sourceIndex !== -1
  const usable = active && !isNoOpSlot(slot, sourceIndex)
  // The lowest slot that is not adjacent to the moving row. Focus lands here
  // when the mode opens, because the menu that started it has just unmounted
  // the button the user activated.
  const isFirstUsable = active && slot === (sourceIndex === 0 ? 2 : 0)

  useEffect(() => {
    if (!usable || !register) return
    return register()
  }, [usable, register])

  useLayoutEffect(() => {
    if (isFirstUsable) ref.current?.focus({ preventScroll: true })
    // placement.instance keys this so re-placing the same row refocuses.
  }, [isFirstUsable, placement?.instance])

  if (!usable || !actions || !placement) return null

  return (
    <button
      ref={ref}
      type="button"
      // 24px of real clickable height: these are newly displayed targets, so
      // WCAG 2.5.8 applies, and a hairline strip between interactive rows
      // would not clear the spacing exception either.
      className="flex h-6 w-full items-center px-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 group"
      aria-label={placementSlotLabel(placement.movingName, slot, rows, section.name)}
      onClick={() => actions.commit(
        placement.itemId,
        visualSlotToInsertIndex(slot, sourceIndex),
        rows,
      )}
    >
      <span
        aria-hidden
        className="h-0.5 w-full rounded bg-blue-300 group-hover:bg-blue-500 group-focus-visible:bg-blue-500"
      />
    </button>
  )
}
