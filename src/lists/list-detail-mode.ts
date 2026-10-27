// Three views of a list: List ('edit'), Pack and Food. Each is a URL
// (src/lists/list-detail-routes.tsx). The retired Organize URLs redirect to
// Pack; a stored last-list path is never one of them (src/lib/last-list-path.ts
// accepts only the bare, /pack and /food shapes).
//
// Food is a WEIGHT ESTIMATE with a schedule attached - what you carry, and
// which meals you eat it at - not a meal planner.
export type ListDetailMode = 'edit' | 'pack' | 'food'

// The human-facing names, used by the view tabs (ListViewNav) and the document
// title. Object order is tab order.
//
// 'edit' is called List: it is the list itself, and Pack and Food are
// sections of it (ListViewNav says why not Category or Gear). The mode key
// and the URL both stay 'edit'/'/lists/:id' so no bookmark, stored
// last-list path or legacy /organize redirect has to move.
export const LIST_VIEW_LABELS: Record<ListDetailMode, string> = {
  edit: 'List',
  pack: 'Pack',
  food: 'Food',
}

export function persistedListPath(listId: string, mode: ListDetailMode): string {
  const base = `/lists/${listId}`
  if (mode === 'pack') return `${base}/pack`
  if (mode === 'food') return `${base}/food`
  return base
}

export function listDocumentTitle(name: string, mode: ListDetailMode): string {
  return `${name} - ${LIST_VIEW_LABELS[mode]}`
}
