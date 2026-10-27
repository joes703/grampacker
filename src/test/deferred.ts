// A promise the test settles by hand, to look at the app while a request is
// still pending. The guard matters: nothing awaits the promise until the code
// under test does, and a rejection settled before that would be an unhandled
// rejection in the test runner itself. Awaiters still see the rejection.
export function deferred<T = void>(): PromiseWithResolvers<T> {
  const d = Promise.withResolvers<T>()
  d.promise.catch(() => {})
  return d
}
