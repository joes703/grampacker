// Pure dedup-key helper for the CSV import planner. Kept dependency-free
// (imports nothing) so the pure planner in import-plan.ts can use it
// without pulling in any I/O module and staying deterministically testable.
//
// The max+1 sortOrder picker for optimistic placeholders is a different
// helper: nextSortOrder in src/lib/queries/sort-keys.ts.

// Composite dedup key: a CSV row matches an existing gear item when its
// category + lowercase name + weight all agree. Same shape used to seed the
// existing-gear map and to look up each row.
//
// Unicode normalization: NFC before lowercase so visually identical names
// that happen to be encoded differently (e.g. "café" with a precomposed
// `é` vs. "café" composed as `e` + combining acute) compare equal.
// Without this, a re-import from a tool that emits NFD created duplicate
// gear rows for the same item. NFC + toLowerCase (not toLocaleLowerCase)
// stays locale-independent so the key is identical in every runtime.
export function gearKey(categoryId: string | null, name: string, weightGrams: number): string {
  return `${categoryId ?? ''}:${name.trim().normalize('NFC').toLowerCase()}:${weightGrams}`
}
