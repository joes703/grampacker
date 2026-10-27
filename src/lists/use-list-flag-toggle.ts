import { useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys, updateList, makeOptimisticUpdate } from '../lib/queries'
import { mutationKeys } from '../lib/queries/keys'
import type { List } from '../lib/types'

type Flag = 'isShared' | 'isDraft'
type ToggleVars = { id: string; flag: Flag; value: boolean }

// The one way to flip isShared or isDraft. A naive toggle (read `!list.flag`
// from the rendered prop) has two races:
//
//   1. The optimistic apply flips the cache at once, but the re-render comes
//      later, so a second click closes over the stale prop and sends the
//      same body twice. For isShared that left a list public while the UI
//      said private.
//   2. A guard on isPending or `disabled` only takes effect after React
//      commits, so two clicks in one commit both pass, and the second reads
//      the flipped cache and sends the opposite value.
//
// So the target value is read once per click from the live cache row and
// travels as the mutation input, and a click is ignored while a mutation for
// the same list and flag is pending anywhere in the app. TanStack marks the
// mutation pending synchronously inside mutate(), so a second click in the
// same tick already sees it.
export function useListFlagToggle(flag: Flag) {
  const qc = useQueryClient()

  const mut = useMutation({
    mutationKey: mutationKeys.toggleListFlag(),
    mutationFn: ({ id, value }: ToggleVars) => updateList(id, { [flag]: value }),
    ...makeOptimisticUpdate<List, ToggleVars>({
      qc,
      queryKey: queryKeys.lists(),
      id: (vars) => vars.id,
      // The server bumps updatedAt on every PATCH, so "updated X ago" tracks
      // the flip; the settled refetch reconciles.
      apply: (item, vars) => ({
        ...item,
        [vars.flag]: vars.value,
        updatedAt: new Date().toISOString(),
      }),
    }),
  })

  function toggle(target: List) {
    const pending = qc.isMutating({
      mutationKey: mutationKeys.toggleListFlag(),
      predicate: (m) => {
        const vars = m.state.variables as ToggleVars | undefined
        return vars?.id === target.id && vars.flag === flag
      },
    })
    if (pending > 0) return
    const live =
      qc.getQueryData<List[]>(queryKeys.lists())?.find((l) => l.id === target.id) ?? target
    mut.mutate({ id: target.id, flag, value: !live[flag] })
  }

  return { toggle, isPending: mut.isPending }
}
