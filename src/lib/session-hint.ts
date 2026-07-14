// A hint, not a credential. It records only "this browser has had a session at
// some point", which is why it is safe to keep in localStorage: it is not
// checked by anything, it gates no UI, and forging it buys an attacker exactly
// one thing - a JavaScript chunk they could have requested by URL anyway. The
// real session lives in an httpOnly cookie the server validates, and that is
// the only thing that decides what a request may see.
//
// It exists to overlap two network round-trips. The authenticated chunk is
// loaded inside RequireSession, so without a hint the sequence for a signed-in
// user is strictly serial: download the entry bundle, ask the server who you
// are, and only then start downloading the app. Splitting the bundle would have
// bought anonymous visitors a smaller download by making every signed-in
// visitor wait an extra round-trip. With the hint, a browser that has signed in
// before starts fetching the app chunk immediately, in parallel with the
// session check, and a browser that has not (the visitor the split is FOR)
// never asks for it at all.
const KEY = 'gp:seen-session'

// localStorage throws, it does not just fail: Safari in private mode and any
// browser with site data blocked will raise on access. A perf hint must never
// be the thing that takes the app down, so both sides swallow.
export function rememberSession(): void {
  try {
    localStorage.setItem(KEY, '1')
  } catch {
    // No hint available. The app still works; the chunk just loads serially.
  }
}

export function hasSeenSession(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}
