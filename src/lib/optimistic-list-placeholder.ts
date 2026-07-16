import type { List } from './types'
import { randomTempId } from './random-temp-id'

// Build an optimistic List row for CACHE-ONLY use during list creation.
// The contract is: TanStack Query writes it into the local cache, the
// real createList mutation resolves with the server-authoritative row,
// and the optimistic row is replaced on settle.
//
// The placeholder uses a DB-VALID `id` (random uuid v4, bare - no
// "temp-" prefix) so the row survives strict consumers like
// last-list-path's uuid regex if it is briefly on screen. `slug` is
// empty: the server mints slugs and there is no client write path that
// could ever persist this row (createList sends only {name}), so the
// old repo's generateSlug DB-validity guardrail has nothing to guard.
// Nothing in this slice renders slug; the share slice consumes it from
// server rows only.
//
// Usage:
//   qc.setQueryData<List[]>(['lists'], (prev) => [
//     ...(prev ?? []),
//     optimisticListPlaceholder({ name, sortOrder }),
//   ])
export function optimisticListPlaceholder(args: {
  name: string
  sortOrder: number
  description?: string | null
}): List {
  const now = new Date().toISOString()
  return {
    id: randomTempId(),
    name: args.name,
    description: args.description ?? null,
    slug: '',
    foodPlanId: null, // a freshly created list has no plan attached
    sortOrder: args.sortOrder,
    isShared: false,
    groupWorn: false,
    readyChecksEnabled: false,
    isDraft: true,
    createdAt: now,
    updatedAt: now,
  }
}
