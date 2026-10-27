import type { ReactNode } from 'react'
import { vi } from 'vitest'

// The @dnd-kit/core stub for page tests that do not exercise dragging: the
// context and overlay render their children, and the sensors do nothing.
//
// Pass `dragEnd` to test a drop: the stub context then renders a
// "fire drag end" button that calls the page's onDragEnd with that event.
// It is called on click, so it may read test state set up after the mock.
//
// Use from a dynamic import, because vi.mock factories are hoisted above the
// file's static imports:
//   vi.mock('@dnd-kit/core', async () =>
//     (await import('../test/dnd-kit-mock')).mockDndKitCore())
export async function mockDndKitCore(dragEnd?: () => { active: { id: string }; over: { id: string } }) {
  const actual = await vi.importActual<typeof import('@dnd-kit/core')>('@dnd-kit/core')
  return {
    ...actual,
    DndContext: ({ children, onDragEnd }: {
      children: ReactNode
      onDragEnd?: (e: unknown) => void
    }) => (
      <div>
        {dragEnd && (
          <button type="button" onClick={() => onDragEnd?.(dragEnd())}>
            fire drag end
          </button>
        )}
        {children}
      </div>
    ),
    DragOverlay: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    useSensor: vi.fn(),
    useSensors: vi.fn(() => []),
  }
}
