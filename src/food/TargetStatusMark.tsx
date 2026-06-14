import { ArrowUp, ArrowDown } from 'lucide-react'
import type { TargetStatus } from '../lib/food/targets'

// Accessible target status: a caret glyph plus a screen-reader label for over/
// under, an sr-only "meets target" for pass, and nothing for the non-graded
// states (off/incomplete/neutral). Never color-only.
export default function TargetStatusMark({ status }: { status: TargetStatus }) {
  if (status === 'over') return (
    <span className="ml-0.5 inline-flex items-center text-rose-600">
      <ArrowUp size={12} aria-hidden="true" /><span className="sr-only">over target</span>
    </span>
  )
  if (status === 'under') return (
    <span className="ml-0.5 inline-flex items-center text-amber-600">
      <ArrowDown size={12} aria-hidden="true" /><span className="sr-only">under target</span>
    </span>
  )
  if (status === 'pass') return <span className="sr-only">meets target</span>
  return null
}
