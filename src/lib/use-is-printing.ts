import { useEffect, useState } from 'react'
import { flushSync } from 'react-dom'

// True while the browser is preparing a printed rendering of the page.
//
// Why this exists at all: some of what a screen shows is decided in
// JavaScript, not CSS. Pack mode's "Show unpacked only" / "Show un-ready
// only" filters remove rows from the rendered array, so no print stylesheet
// can bring them back - print with a filter on and the sheet is silently
// missing items, with the filter controls themselves hidden from the paper so
// there is no clue why. A checklist that quietly omits gear is worse than no
// checklist. The page reads this flag and renders the FULL collection.
//
// flushSync is load-bearing. `beforeprint` fires immediately before the
// browser snapshots the document, and React 18+ batches state updates from
// native event listeners - the re-render would land after the snapshot and
// the sheet would go out filtered anyway. flushSync forces it to complete
// inside the handler. It is safe here because these are DOM event listeners,
// not a React lifecycle.
//
// Both mechanisms are registered: `beforeprint`/`afterprint` where available,
// and a `matchMedia('print')` change listener for engines that only surface
// the transition that way. Either may fire alone or both may fire; setting
// the same boolean twice is harmless.
export function useIsPrinting(): boolean {
  const [printing, setPrinting] = useState(false)

  useEffect(() => {
    const enter = () => {
      flushSync(() => setPrinting(true))
    }
    // No flushSync on the way out: nothing is waiting on this render, and
    // forcing it synchronously during an event React did not schedule buys
    // nothing.
    const exit = () => setPrinting(false)

    window.addEventListener('beforeprint', enter)
    window.addEventListener('afterprint', exit)

    // matchMedia is absent in some test environments; the listeners above
    // still cover the ordinary path.
    const mql = window.matchMedia?.('print')
    const onChange = (event: MediaQueryListEvent) => {
      if (event.matches) enter()
      else exit()
    }
    mql?.addEventListener('change', onChange)

    return () => {
      window.removeEventListener('beforeprint', enter)
      window.removeEventListener('afterprint', exit)
      mql?.removeEventListener('change', onChange)
    }
  }, [])

  return printing
}
