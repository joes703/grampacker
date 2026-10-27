import type { QueryClient, UseMutationOptions } from '@tanstack/react-query'
import {
  queryKeys,
  createCategory,
  makeOptimisticInsert,
  nextSortOrder,
} from './queries'
import { randomTempId } from './random-temp-id'
import type { Category } from './types'

// The one add-category mutation recipe. The gear page's category actions and
// the list page's gear actions each drive createCategory with the identical
// optimistic insert (temp id, next sort slot from the cached rows, same
// placeholder shape); this builder keeps them from drifting. Each caller
// supplies its own inline mutationKey (the keys are distinct on purpose, so
// per-surface isMutating matchers keep working, and lint requires the key
// inline at every useMutation call).
//
// `categories` seeds the optimistic placeholder's sort slot - the server
// assigns the real sortOrder (max+1) and the placeholder computes the same
// value from the cached rows.
export function addCategoryMutationOptions(
  qc: QueryClient,
  categories: Category[],
): Omit<
  UseMutationOptions<Category, Error, string, { previous: Category[] | undefined }>,
  'mutationKey'
> {
  return {
    mutationFn: (name: string) => createCategory(name),
    ...makeOptimisticInsert<Category, string>({
      qc,
      queryKey: queryKeys.categories(),
      optimistic: (name) => ({
        id: `temp-${randomTempId()}`,
        name,
        sortOrder: nextSortOrder(categories),
        createdAt: new Date().toISOString(),
      }),
    }),
  }
}
