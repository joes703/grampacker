import { useSyncExternalStore } from 'react'
import {
  WEIGHT_UNIT_EVENT,
  WEIGHT_UNIT_KEY,
  getWeightUnit,
  setWeightUnit,
  type WeightUnit,
} from './weight'

// useSyncExternalStore against localStorage so all mounted consumers stay in
// lockstep. Previously the hook held per-consumer useState, which meant
// NavBar's toggle updated NavBar but left ListDetailPage / GearLibraryPage /
// SharePage on their stale value until a re-render unrelated to the unit
// happened to flush them.
//
// Two event sources, both routed through the same subscribe:
//   - 'storage'           : fires in OTHER tabs after a localStorage write
//                           (the browser does not fire it in the originating
//                           tab — that's why we need the custom event below).
//   - 'weight-unit-change': dispatched by setWeightUnit() inside this tab.
//
// React's useSyncExternalStore short-circuits the re-render when the new
// snapshot is reference-equal to the old one. WeightUnit is a primitive
// string, so equal values are reference-equal automatically — no need to
// memoize.
function subscribe(onChange: () => void) {
  if (typeof window === 'undefined') return () => {}
  // Filter `storage` to our key so unrelated localStorage writes in other
  // tabs don't trigger gratuitous wake-ups. e.key === null means
  // localStorage.clear(), which we do want to react to.
  const handleStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === WEIGHT_UNIT_KEY) onChange()
  }
  window.addEventListener('storage', handleStorage)
  window.addEventListener(WEIGHT_UNIT_EVENT, onChange)
  return () => {
    window.removeEventListener('storage', handleStorage)
    window.removeEventListener(WEIGHT_UNIT_EVENT, onChange)
  }
}

function getSnapshot(): WeightUnit {
  return getWeightUnit()
}

// SSR/test fallback. Same default as getWeightUnit when localStorage is
// missing or the value is unrecognized.
function getServerSnapshot(): WeightUnit {
  return 'g'
}

export function useWeightUnit(): {
  weightUnit: WeightUnit
  toggleWeightUnit: () => void
  /** Set the unit to an absolute value. Used by segmented controls
   *  (Settings, SharePage) that present each unit as its own button
   *  rather than a single toggle. */
  setUnit: (unit: WeightUnit) => void
} {
  const weightUnit = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  function toggleWeightUnit() {
    // setWeightUnit writes localStorage AND dispatches WEIGHT_UNIT_EVENT, so
    // every mounted consumer's getSnapshot re-runs and any with a changed
    // value re-renders. No setState here — the hook is no longer the
    // source of truth.
    setWeightUnit(weightUnit === 'g' ? 'oz' : 'g')
  }

  function setUnit(unit: WeightUnit) {
    setWeightUnit(unit)
  }

  return { weightUnit, toggleWeightUnit, setUnit }
}
