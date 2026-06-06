import type { List } from './types'
import { generateSlug } from './slug'
import { randomTempId } from './random-temp-id'

// Build an optimistic List row for CACHE-ONLY use during list creation.
// **NEVER call .insert() with this row.** The contract is: TanStack
// Query writes it into the local cache, the real createList mutation
// resolves with the server-authoritative row, and the optimistic row
// is replaced on settle.
//
// The placeholder uses DB-VALID values for `id` (random uuid v4) and
// `slug` (6-char generator matching the server's slug). DB-validity is
// a guardrail against constraint failures if the row ever leaks to a
// persist call by mistake — the previous shape (`temp-${uuid}` for
// both) would have hit 22P02 (invalid uuid) or 23514 (slug CHECK).
// DB-valid does NOT mean "safe to persist": a stray .insert() would
// create a real, orphan list row that the server didn't authorize.
// The optimistic-state-must-not-persist invariant still belongs to
// every caller of this helper.
//
// Usage:
//   qc.setQueryData<List[]>(['lists'], (prev) => [
//     ...(prev ?? []),
//     optimisticListPlaceholder({ name, userId, sortOrder }),
//   ])
export function optimisticListPlaceholder(args: {
  name: string
  userId: string
  sortOrder: number
  description?: string | null
}): List {
  const now = new Date().toISOString()
  return {
    id: randomTempId(),
    user_id: args.userId,
    name: args.name,
    description: args.description ?? null,
    slug: generateSlug(),
    sort_order: args.sortOrder,
    is_shared: false,
    group_worn: false,
    ready_checks_enabled: false,
    is_draft: true,
    created_at: now,
    updated_at: now,
  }
}
