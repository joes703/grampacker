import { useRef } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { UpdateListRequest } from '../../shared/lists'
import { queryKeys, updateList, makeOptimisticUpdate } from '../lib/queries'
import type { List } from '../lib/types'

type ToggleVars = { id: string; value: boolean }

// Race-proof optimistic toggle for a boolean list flag. THE canonical way
// to flip isShared / isDraft / groupWorn / readyChecksEnabled - the naive
// shape (mutationFn reading `!list.flag` from the rendered prop, apply
// flipping the cache row) carries two races, both found by the Codex
// review of PR #29:
//
//   1. Stale-prop double-send: onMutate flips the cache synchronously but
//      observer notifications are scheduled, so a second activation
//      before the re-render closes over the stale prop and PATCHes the
//      SAME body twice. For isShared that left a list PUBLIC while the
//      UI said private.
//   2. Render-derived guards don't close it: isPending (and the disabled
//      attribute it drives) only takes effect after React commits, so two
//      activations in the same commit window both pass - and because the
//      cache flipped synchronously, the second derives the OPPOSITE
//      target, putting {true} then {false} on the wire where out-of-order
//      resolution still ends wrong.
//
// The pattern here closes both:
//   - the target value is resolved ONCE per activation from the live
//     cache row (falling back to the passed snapshot on a cold cache),
//     and travels as the mutation input, so the PATCH body and the
//     optimistic apply can never disagree;
//   - a synchronous ref (per list id, so toggling list A never locks
//     list B) makes the second same-tick activation a complete no-op;
//     it re-arms in the per-call onSettled, which TanStack fires on
//     success AND error.
//
// Scope note: the ref lives per hook instance, so two DIFFERENT mounted
// surfaces flipping the same flag inside one flight window can still
// cross (e.g. the header Draft pill and the settings panel toggle). A
// module-level lock would close that but wedges permanently if the
// surface unmounts mid-flight (per-call onSettled only fires while the
// observer is mounted). Same-control double-activation is the real-world
// case; cross-surface simultaneity is accepted.
//
// `read`/`patch` name the flag once at the call site:
//   const shareToggle = useListFlagToggle({
//     read: (l) => l.isShared,
//     patch: (isShared) => ({ isShared }),
//   })
//   ...
//   shareToggle.toggle(list)
export function useListFlagToggle(opts: {
  read: (list: List) => boolean
  patch: (value: boolean) => UpdateListRequest
}) {
  const qc = useQueryClient()
  const inFlight = useRef<Set<string>>(new Set())

  const mut = useMutation({
    mutationFn: ({ id, value }: ToggleVars) => updateList(id, opts.patch(value)),
    ...makeOptimisticUpdate<List, ToggleVars>({
      qc,
      queryKey: queryKeys.lists(),
      id: (vars) => vars.id,
      // updatedAt bumps optimistically so "updated X ago" tracks the flip
      // (the server bumps it on every PATCH; the settled refetch
      // reconciles).
      apply: (item, vars) => ({
        ...item,
        ...opts.patch(vars.value),
        updatedAt: new Date().toISOString(),
      }),
    }),
  })

  function toggle(target: List) {
    if (inFlight.current.has(target.id)) return
    inFlight.current.add(target.id)
    const live =
      qc.getQueryData<List[]>(queryKeys.lists())?.find((l) => l.id === target.id) ?? target
    mut.mutate(
      { id: target.id, value: !opts.read(live) },
      {
        onSettled: () => {
          inFlight.current.delete(target.id)
        },
      },
    )
  }

  return { toggle, isPending: mut.isPending }
}
