import {
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'

// The drag sensors every reorderable surface uses. Mouse drags start after
// 5px, so a click stays a click. Touch drags start after a 200ms press, so a
// tap opens the row and a swipe still scrolls. Keyboard drags use the sortable
// arrow-key coordinates. A desktop-only surface passes touch: false.
export function useDragSensors({ touch = true }: { touch?: boolean } = {}) {
  const mouse = useSensor(MouseSensor, { activationConstraint: { distance: 5 } })
  const touchSensor = useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } })
  const keyboard = useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  return useSensors(mouse, touch ? touchSensor : null, keyboard)
}
