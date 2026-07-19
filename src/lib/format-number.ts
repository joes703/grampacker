// Format a number with at most `digits` decimal places, trailing zeros
// trimmed:
//   trimNumber(30, 1)   -> "30"
//   trimNumber(30.5, 1) -> "30.5"
//   trimNumber(2.5, 3)  -> "2.5"
//
// Ported from the old repo: one generic helper so call sites declare the
// precision their surface needs instead of hard-coding drifting toFixed()s.
export function trimNumber(value: number, digits: number): string {
  return String(Number(value.toFixed(digits)))
}
