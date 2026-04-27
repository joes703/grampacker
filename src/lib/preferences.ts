// User-machine-local preferences persisted in localStorage. Namespace every
// key under `grampacker:` so we don't collide with anything else on the same
// origin.

const LAST_LIST_KEY = 'grampacker:lastListId'

export function getLastListId(): string | null {
  if (typeof localStorage === 'undefined') return null
  return localStorage.getItem(LAST_LIST_KEY)
}

export function setLastListId(id: string): void {
  localStorage.setItem(LAST_LIST_KEY, id)
}
