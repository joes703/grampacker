import type { QueryClient, QueryKey } from '@tanstack/react-query'

// Refetch once per burst of overlapping optimistic writes, after the last one
// settles. A refetch fired while a sibling write is still pending can land
// stale server data over that sibling's optimistic value; the one trailing
// refetch is what re-converges the cache with server truth.
//
// Why a counter and not qc.isMutating(): TanStack awaits a mutation's
// onSettled BEFORE it marks the mutation settled (query-core mutation.js), so
// when two responses land in the same tick, both onSettled calls can still
// count two pending mutations, and neither refetches. Counting in onMutate and
// onSettled ourselves is synchronous, so exactly one settle sees zero.
//
// Call start() first thing in onMutate (TanStack calls onSettled even when
// onMutate throws, so the count stays balanced) and settle() in onSettled.
// The count lives per QueryClient and per `burstKey`, so every hook instance
// writing the same burst shares it.
const inFlight = new WeakMap<QueryClient, Map<string, number>>()

export function burstRefetch(qc: QueryClient, burstKey: QueryKey, refetchKey: QueryKey) {
  const id = JSON.stringify(burstKey)
  const counts = () => {
    let map = inFlight.get(qc)
    if (!map) {
      map = new Map()
      inFlight.set(qc, map)
    }
    return map
  }
  return {
    start() {
      const map = counts()
      map.set(id, (map.get(id) ?? 0) + 1)
    },
    settle() {
      const map = counts()
      const left = (map.get(id) ?? 1) - 1
      if (left > 0) {
        map.set(id, left)
        return
      }
      map.delete(id)
      void qc.invalidateQueries({ queryKey: refetchKey })
    },
  }
}
