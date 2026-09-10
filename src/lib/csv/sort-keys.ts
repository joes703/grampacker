// Pure dedup-key helper for the CSV import planner. Kept dependency-free
// (imports nothing) so the pure planner in import-plan.ts can use it
// without pulling in any I/O module and staying deterministically testable.
//
// TRANSPLANT NOTE: the old repo also exported nextCategorySortOrder /
// nextGearItemSortOrder here (max+1 slot pickers for client-side inserts).
// The server assigns sortOrder itself now, so those pickers moved out of the
// import path: they live in src/lib/queries/sort-keys.ts and feed only the
// optimistic placeholders.

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
