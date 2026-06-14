// One-time client teardown for the removed service worker. Runs at app boot
// as defense-in-depth behind public/sw.js (the kill worker): it unregisters
// any leftover SW, purges Cache Storage, and removes localStorage keys the
// SW cannot touch. Every step is feature-detected and wrapped so a
// private-mode SecurityError or a missing API can never break boot.
//
// Keys removed are the dead offline keys ONLY, by exact name - never a
// wildcard sweep (grampacker:passkey-nudge-pending and the last-list-path
// key must survive).
export async function runServiceWorkerTeardown(): Promise<void> {
  try {
    const regs = await navigator.serviceWorker?.getRegistrations?.()
    if (regs) await Promise.all(regs.map((r) => r.unregister()))
  } catch {
    /* no SW support, or a private-mode rejection - nothing to undo */
  }

  try {
    if (typeof caches !== 'undefined') {
      const keys = await caches.keys()
      await Promise.all(keys.map((k) => caches.delete(k)))
    }
  } catch {
    /* Cache Storage can reject with SecurityError in private mode */
  }

  try {
    localStorage.removeItem('grampacker:pending-checks:v2')
  } catch {
    /* localStorage can throw in restricted contexts */
  }
}
