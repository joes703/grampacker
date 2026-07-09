import { useEffect, useRef } from 'react'

// Same-batch arbiter for inline edit inputs whose Enter, Escape, and blur
// handlers all invoke commit/cancel closures from one render. When two of
// those events are delivered in a single batch - Enter then blur, Escape
// then blur - React hasn't re-rendered between them, so both closures see
// the pre-submit state and the commit runs twice (or a cancel is overridden
// by a stale blur commit). For rename PATCHes that's a duplicate request;
// for the create-list and quick-add flows it's a second row.
//
// The returned wrapper admits ONE call per committed render and re-arms
// after every re-render. Within one event batch no re-render can occur, so
// the second delivery is dropped; legitimate follow-ups (retry after a
// validation error or a failed mutation, the next rapid-entry submit)
// always happen after React has re-rendered, when the guard is open again.
//
// Scope note: this collapses same-batch duplicates only. It does NOT guard
// an async commit across its await (the pending window spans many renders);
// PasskeySection's rename keeps its own ref for that.
export function useCommitOnce(): (fn: () => void) => void {
  const consumed = useRef(false)
  useEffect(() => {
    consumed.current = false
  })
  const guard = useRef((fn: () => void) => {
    if (consumed.current) return
    consumed.current = true
    fn()
  })
  return guard.current
}
