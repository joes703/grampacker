// Legacy service-worker KILL-WORKER - intentionally retained. This is NOT
// active PWA/offline/install behavior: grampacker is an online-only web app
// and registers no service worker. This self-destroying worker exists ONLY to
// tear down the former Workbox SW for returning clients still controlled by
// it. It REPLACES that old SW at the same /sw.js URL: such a client revalidates
// this script from network on its next navigation, installs it, and it then
// wipes all caches and unregisters itself.
//
// DO NOT DELETE. KEEP THIS FILE INDEFINITELY: if /sw.js ever 404s, the old
// SW's update check fails and leaves the stale precached shell controlling the
// page forever, stranding the user on a dead app. A guard test
// (src/lib/legacy-sw-kill-worker.test.ts) fails the build if this file is
// removed or stops self-destructing, so a future "dead code" sweep cannot drop
// it by accident. See docs/superpowers/plans/2026-06-14-offline-pwa-removal.md
// section 4 for the full rationale.
self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    await self.clients.claim()
    // Wipe precache + supabase-rest. Wrapped so a Cache Storage rejection
    // can't prevent the far more important unregister + reload below - the
    // whole point of this worker is that it reliably self-destructs.
    try {
      const keys = await caches.keys()
      await Promise.all(keys.map((k) => caches.delete(k)))
    } catch {
      /* cache teardown is best-effort; never block unregister on it */
    }
    await self.registration.unregister()
    // Reload every window (including not-yet-controlled ones) into the
    // SW-less app. Wrap each navigate so one failure can't reject teardown.
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const client of clients) {
      try {
        await client.navigate(client.url)
      } catch {
        /* one bad navigate must not abort the rest of teardown */
      }
    }
  })())
})
