import { useState } from 'react'
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryKey,
} from '@tanstack/react-query'
import { arrayMove } from '@dnd-kit/sortable'
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core'
import { parseDnDId } from './dnd-ids'
import { assignSortOrderSlots } from './grouping'
import { makeOptimisticReorder } from './queries/optimistic'

// Reorder state machine for a single flat sortable surface. Owns the
// useQuery subscription for the cached array, the useMutation that writes
// the new sort_order set, the activeId state for the DragOverlay, and the
// validate + arrayMove + dispatch shape of handleDragEnd. The page keeps
// layout ownership: it wires DndContext (with surface-specific sensors),
// SortableContext (with the items the hook returns), and DragOverlay
// (rendering its own clone JSX off activeItem).
//
// Why the hook owns useQuery — and the page MUST consume the hook's items:
//   dnd-kit fires its drop transition in the same tick as onDragEnd.
//   makeOptimisticReorder is synchronous in onMutate so the cache write
//   lands in that same tick; React 18 then batches the resulting observer
//   notification with the local setActiveId(null) update into one commit.
//   If the SortableContext rendered items prop-drilled from a parent
//   useQuery, React could split the local state and the parent observer
//   into separate commits, the drop animation runs against the old DOM
//   order, and the dropped row visibly snaps back before jumping. This
//   is the b8624ec / 703a936 race class.
//
//   The structural fix is that the component rendering SortableContext
//   subscribes to the cache itself, in the same component as setActiveId.
//   Using this hook is that subscription. The hook returns items, the
//   page renders SortableContext items={hookItems.map(...)} — the page
//   cannot use a parent-prop items array and still get the guarantee.
//
//   For surfaces that don't use this hook (today: list-item rows within
//   category on /lists/:id, and gear-item rows within category on /gear),
//   the rule remains narrated in src/lib/queries/optimistic.ts (the
//   corollary on makeOptimisticReorder) and in CLAUDE.md. The hook
//   enforces the rule structurally only where it is used.
//
// Multi-kind pages (e.g. GearLibraryPage owns both category reorder and
// gear-item reorder under one DndContext) instantiate one hook per
// reorder cache. Each hook self-gates on dndKind: a drop with a
// non-matching kind causes handleDragEnd to no-op, so the page's
// page-level handler can safely call multiple hooks' handlers in
// sequence without worrying about cross-fire.

// Pure helper. Validates a drag-end event against a cached items array
// and produces the mutation payload, or { ok: false } if the drop should
// be ignored. Extracted so the validation algebra is testable without
// mounting React or dnd-kit.
//
// Rejection cases — matches what every reorder page hand-rolled before:
//   1. no over id (drop landed outside any droppable)
//   2. active id === over id (no-op drop on self)
//   3. activeId fails to parse, or parsed kind != dndKind
//   4. overId fails to parse, or parsed kind != dndKind
//   5. activeId not in items (stale id; cache moved on between drag
//      start and drop)
//   6. overId not in items (same)
//   7. oldIndex === newIndex (item already at target slot after some
//      intermediate reorder)
//
// Acceptance case: arrayMove the items into their new order, then call
// buildUpdates to translate the reordered array into the
// { id, sort_order }[] payload the mutation expects. Default is
// assignSortOrderSlots; callers that historically renumber 0..N-1
// (categories on /gear, before this hook landed) pass their own.
export type ReorderUpdates = { id: string; sort_order: number }[]

export type PlanReorderInput<T extends { id: string; sort_order: number }> = {
  activeId: string | number | undefined
  overId: string | number | undefined
  items: T[]
  dndKind: string
  buildUpdates?: (reordered: T[]) => ReorderUpdates
}

export type PlanReorderResult =
  | { ok: false }
  | { ok: true; updates: ReorderUpdates }

export function planReorder<T extends { id: string; sort_order: number }>({
  activeId,
  overId,
  items,
  dndKind,
  buildUpdates = assignSortOrderSlots,
}: PlanReorderInput<T>): PlanReorderResult {
  if (activeId === undefined || activeId === null) return { ok: false }
  if (overId === undefined || overId === null) return { ok: false }
  if (activeId === overId) return { ok: false }

  const activeParsed = parseDnDId(String(activeId))
  if (!activeParsed || activeParsed.kind !== dndKind) return { ok: false }
  const overParsed = parseDnDId(String(overId))
  if (!overParsed || overParsed.kind !== dndKind) return { ok: false }

  const oldIndex = items.findIndex((i) => i.id === activeParsed.id)
  if (oldIndex === -1) return { ok: false }
  const newIndex = items.findIndex((i) => i.id === overParsed.id)
  if (newIndex === -1) return { ok: false }
  if (oldIndex === newIndex) return { ok: false }

  const reordered = arrayMove(items, oldIndex, newIndex)
  return { ok: true, updates: buildUpdates(reordered) }
}

type UseReorderableOptions<T extends { id: string; sort_order: number }> = {
  // The cache the SortableContext sorts against. The hook subscribes here
  // via useQuery, and that subscription is the structural same-tick
  // enforcement described in the file-level comment.
  queryKey: QueryKey
  queryFn: () => Promise<T[]>
  // First-paint seed when a parent already had this data in hand (e.g.
  // DesktopListsPanel receives lists from ListDetailPage's useQuery).
  // The hook's useQuery is still the source of truth on every subsequent
  // render; initialData just avoids a flash.
  initialData?: T[]
  mutationFn: (updates: ReorderUpdates) => Promise<unknown>
  // Filter for drag events on this surface. Multi-kind pages instantiate
  // one hook per kind; each handleDragEnd no-ops on drops whose parsed
  // kind doesn't match, so the page can call them all in sequence.
  dndKind: string
  // Per-surface payload strategy. Default is assignSortOrderSlots
  // (permute existing slot values — matches what most surfaces use).
  // Pass a renumber-from-zero builder for category reorder on /gear,
  // which has used full renumber since before assignSortOrderSlots
  // existed and whose seed data is contiguous 0..N-1.
  buildUpdates?: (reordered: T[]) => ReorderUpdates
}

type UseReorderableResult<T extends { id: string; sort_order: number }> = {
  items: T[]
  isLoading: boolean
  activeItem: T | null
  reorderPending: boolean
  handleDragStart: (e: DragStartEvent) => void
  handleDragCancel: () => void
  // Strictly self-gates on dndKind, so multi-kind pages can safely call
  // multiple hooks' handlers in sequence without cross-fire.
  handleDragEnd: (e: DragEndEvent) => void
}

export function useReorderable<T extends { id: string; sort_order: number }>(
  opts: UseReorderableOptions<T>,
): UseReorderableResult<T> {
  const { queryKey, queryFn, initialData, mutationFn, dndKind, buildUpdates } = opts
  const qc = useQueryClient()

  const { data: items = (initialData ?? ([] as T[])), isLoading } = useQuery({
    queryKey,
    queryFn,
    ...(initialData !== undefined ? { initialData } : {}),
  })

  const reorderMut = useMutation({
    mutationFn,
    ...makeOptimisticReorder<T>(qc, queryKey),
  })

  const [activeId, setActiveId] = useState<string | null>(null)

  const activeParsed = activeId ? parseDnDId(activeId) : null
  const activeItem =
    activeParsed?.kind === dndKind
      ? items.find((i) => i.id === activeParsed.id) ?? null
      : null

  function handleDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id))
  }

  function handleDragCancel() {
    setActiveId(null)
  }

  function handleDragEnd(e: DragEndEvent) {
    setActiveId(null)
    const { active, over } = e
    const plan = planReorder<T>({
      activeId: active.id as string | number,
      overId: over?.id as string | number | undefined,
      items,
      dndKind,
      buildUpdates,
    })
    if (!plan.ok) return
    reorderMut.mutate(plan.updates)
  }

  return {
    items,
    isLoading,
    activeItem,
    reorderPending: reorderMut.isPending,
    handleDragStart,
    handleDragCancel,
    handleDragEnd,
  }
}
