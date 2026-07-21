export type ListDetailMode = 'edit' | 'pack' | 'organize'
export type ToggleableListMode = Exclude<ListDetailMode, 'edit'>

export function deriveListMode(
  pathname: string,
  search: string,
  listId: string,
): ListDetailMode {
  const base = `/lists/${listId}`
  if (
    pathname === `${base}/organize` ||
    pathname === `${base}/pack/organize`
  ) return 'organize'
  const legacyPackMode =
    pathname === base && new URLSearchParams(search).get('mode') === 'pack'
  if (pathname === `${base}/pack` || legacyPackMode) return 'pack'
  return 'edit'
}

export function persistedListPath(listId: string, mode: ListDetailMode): string {
  const base = `/lists/${listId}`
  if (mode === 'pack') return `${base}/pack`
  if (mode === 'organize') return `${base}/organize`
  return base
}

export function toggledListModePath(
  listId: string,
  current: ListDetailMode,
  target: ToggleableListMode,
): string {
  return current === target
    ? `/lists/${listId}`
    : `/lists/${listId}/${target}`
}
