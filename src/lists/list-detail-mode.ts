export type ListDetailMode = 'edit' | 'pack' | 'organize'

export function deriveListMode(
  pathname: string,
  search: string,
  listId: string,
): ListDetailMode {
  const base = `/lists/${listId}`
  if (pathname === `${base}/pack/organize`) return 'organize'
  const legacyPackMode =
    pathname === base && new URLSearchParams(search).get('mode') === 'pack'
  if (pathname === `${base}/pack` || legacyPackMode) return 'pack'
  return 'edit'
}

export function persistedListPath(listId: string, mode: ListDetailMode): string {
  return mode === 'edit' ? `/lists/${listId}` : `/lists/${listId}/pack`
}
