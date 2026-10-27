// The max+1 sortOrder slot for a new row: the server assigns the persisted
// slot on create, and the optimistic write paths compute the same value over
// the cached rows so a placeholder lands where the server row will. Deletes
// do not compact the survivors, so the sequence is sparse after any delete:
// length-based slot picking would tie with an existing row and silently
// reshuffle the (sortOrder, name) read order. The CSV import planner does not
// use this: its dedup key lives in src/lib/csv/sort-keys.ts.
export function nextSortOrder(existing: readonly { sortOrder: number }[]): number {
  let max = -1
  for (const row of existing) if (row.sortOrder > max) max = row.sortOrder
  return max + 1
}
