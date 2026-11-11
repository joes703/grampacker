import { act } from '@testing-library/react'

// Wait for the component's own continuation on a settled deferred (see
// ./deferred), and for React to flush whatever state update it made. Promise
// reactions run FIFO and the component registered its await when the request
// started, so by the time this returns its continuation has run. Tests that
// assert an ABSENCE (a stale completion that must not land) need this: a bare
// `waitFor` on something already true returns before the continuation runs,
// and would pass against code with no guard at all.
export async function settle(d: PromiseWithResolvers<unknown>): Promise<void> {
  await act(async () => {
    await d.promise.catch(() => {})
  })
}
