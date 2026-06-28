// Format a number with at most `digits` decimal places, trailing zeros trimmed:
//   trimNumber(30, 1)   -> "30"
//   trimNumber(30.5, 1) -> "30.5"
//   trimNumber(2.5, 3)  -> "2.5"
//
// One generic helper replacing four food-domain copies that had each hard-coded
// a different fixed precision (toFixed 3 / 2 / 1) and silently drifted apart.
// Lives in lib (not the food layer) because it is not food-specific and one
// caller is in src/lists; keeping precision an explicit argument means each call
// site still declares the precision its surface needs.
export function trimNumber(value: number, digits: number): string {
  return String(Number(value.toFixed(digits)))
}
