// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import {
  SidebarDrawerProvider,
  useRegisterSidebarDrawer,
  useSidebarDrawer,
} from './sidebar-drawer-context'

afterEach(cleanup)

function Registration({ enabled }: { enabled: boolean }) {
  useRegisterSidebarDrawer(enabled)
  return null
}

function Availability() {
  const { available } = useSidebarDrawer()
  return <span>{available ? 'available' : 'unavailable'}</span>
}

function Harness({ enabled }: { enabled: boolean }) {
  return (
    <SidebarDrawerProvider>
      <Registration enabled={enabled} />
      <Availability />
    </SidebarDrawerProvider>
  )
}

describe('useRegisterSidebarDrawer', () => {
  it('withdraws drawer availability while a route keeps the page mounted but disables it', async () => {
    const { rerender } = render(<Harness enabled />)
    await waitFor(() => expect(screen.getByText('available')).toBeInTheDocument())

    rerender(<Harness enabled={false} />)
    await waitFor(() => expect(screen.getByText('unavailable')).toBeInTheDocument())
  })
})
