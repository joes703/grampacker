// Self-destroying service worker. This REPLACES the former Workbox SW at the
// same /sw.js URL. A returning client still controlled by the old SW fetches
// this script on its next navigation (the SW script itself is revalidated
// from network), installs it, and it then wipes all caches and unregisters
// itself. KEEP THIS FILE INDEFINITELY: if /sw.js ever 404s, the old SW's
// update check fails and leaves the stale precached shell controlling the
// page forever. See docs/superpowers/plans/2026-06-14-offline-pwa-removal.md
// section 4 for the full rationale.
self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    await self.clients.claim()
    const keys = await caches.keys()
    await Promise.all(keys.map((k) => caches.delete(k))) // wipe precache + supabase-rest
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
