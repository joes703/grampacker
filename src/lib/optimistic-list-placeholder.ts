import type { List } from './types'
import { unconfirmedId } from './unconfirmed-id'

// The optimistic List row shown while a create is pending
// (makeOptimisticInsert swaps in the server row when the POST answers). Its
// id is unconfirmed, so drags, the row menu and the row link all skip it.
// `slug` is empty: the server mints slugs, and nothing sends this row to the
// server.
export function optimisticListPlaceholder(args: {
  name: string
  sortOrder: number
  description?: string | null
}): List {
  const now = new Date().toISOString()
  return {
    id: unconfirmedId(),
    name: args.name,
    description: args.description ?? null,
    slug: '',
    sortOrder: args.sortOrder,
    isShared: false,
    isDraft: true,
    createdAt: now,
    updatedAt: now,
  }
}
