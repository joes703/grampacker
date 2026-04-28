import { useEffect } from 'react'

// Sets document.title to "<title> · grampacker" while the calling component
// is mounted, falling back to "grampacker" when title is null/undefined
// (e.g. while data needed for the title is still loading). Reactive on
// every title change, so pages can pass a value derived from query data
// and the tab title updates as soon as the data resolves. No teardown —
// the next page's hook overwrites on mount.
const SUFFIX = ' · grampacker'

export function useDocumentTitle(title: string | null | undefined) {
  useEffect(() => {
    document.title = title ? `${title}${SUFFIX}` : 'grampacker'
  }, [title])
}
