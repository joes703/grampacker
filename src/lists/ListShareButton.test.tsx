// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import ListShareButton from './ListShareButton'
import type { List } from '../lib/types'

// Sharing used to live only inside List options, between Rename and Delete.
// Both 2026-10 UX audits took three clicks to find it, and sharing is the end
// goal of building a list for this audience - so it gets its own toolbar
// button. ONE home, moved rather than copied: List options no longer hosts it
// (ListSettingsPanel.test pins that side).

const list: List = {
  id: 'l1',
  name: 'Trip',
  description: null,
  slug: 'abc123',
  isShared: false,
  isDraft: false,
  sortOrder: 0,
  createdAt: '',
  updatedAt: '',
}

afterEach(() => cleanup())

function renderButton() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ListShareButton list={list} />
    </QueryClientProvider>,
  )
}

describe('ListShareButton', () => {
  it('opens the privacy panel from a labeled toolbar button', async () => {
    renderButton()
    await userEvent.click(screen.getByRole('button', { name: 'Share' }))
    expect(screen.getByText('Shared')).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Enable public link' })).toBeInTheDocument()
  })
})
