import type { List } from './types'
import { generateSlug } from './slug'

// Build an optimistic List row for cache-write purposes during list creation.
//
// The placeholder uses DB-VALID values for `id` (random uuid v4) and
// `slug` (6-char generator matching the server's slug). The intent is
// still that the server response replaces this row before the cache
// settles — but if that contract is ever broken (e.g. a future refactor
// that accidentally persists the optimistic state), a leak fails soft:
// the row just doesn't replace anything, no 23514 CHECK violation, no
// 22P02 invalid_text_representation. UUID-vs-real-id collision is
// astronomically unlikely; slug collision is handled by withSlugRetry on
// the real insert.
//
// Pre-Phase-11 sites used `temp-${crypto.randomUUID()}` for both `id`
// and `slug`, which were both DB-invalid (uuid column rejects the
// "temp-" prefix; slug CHECK requires char_length = 6).
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
    id: crypto.randomUUID(),
    user_id: args.userId,
    name: args.name,
    description: args.description ?? null,
    slug: generateSlug(),
    sort_order: args.sortOrder,
    is_shared: false,
    created_at: now,
    updated_at: now,
  }
}
