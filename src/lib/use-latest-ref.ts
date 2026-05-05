import { useEffect, useRef, type RefObject } from 'react'

/**
 * Track the latest committed value in a ref so that closures running AFTER
 * commit (event handlers, setTimeout/microtasks, async callbacks) see the
 * freshest data without depending on the value in their `useCallback` /
 * `useMemo` deps.
 *
 * Why an effect, not a synchronous render-time write:
 * React 19's `react-hooks/refs` lint rule flags `ref.current = value` during
 * render as an anti-pattern (it can tear under concurrent rendering — the
 * ref mutation runs even when the render is later thrown away). Updating
 * inside `useEffect` is safe because effects only fire on committed renders.
 *
 * Usage contract: the returned ref is stale during render and during
 * `useLayoutEffect`. Read `.current` ONLY from event handlers or async work
 * that runs after commit. For our list-detail mutations, all reads happen
 * inside user-triggered handlers, so this is safe.
 */
export function useLatestRef<T>(value: T): RefObject<T> {
  const ref = useRef(value)
  useEffect(() => {
    ref.current = value
  }, [value])
  return ref
}
