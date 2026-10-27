// The gear search used by the gear library and the list page's gear picker:
// case-insensitive, on the name or the description, ignoring surrounding
// spaces. An empty search returns the same array.
export function filterGearBySearch<T extends { name: string; description: string | null }>(
  items: T[],
  search: string,
): T[] {
  const q = search.trim().toLowerCase()
  if (!q) return items
  return items.filter(
    (item) =>
      item.name.toLowerCase().includes(q) || (item.description?.toLowerCase().includes(q) ?? false),
  )
}
