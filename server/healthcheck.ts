import { pathToFileURL } from 'node:url'

// The container's health check (Dockerfile HEALTHCHECK). Docker runs it as a
// separate process inside the container:
//
//   node dist/server/healthcheck.js
//
// It uses Node's own fetch so the image needs no curl. Healthy means HTTP 200
// AND a JSON body whose `ok` is exactly true, within the timeout
// Receiving some HTTP response is not
// enough: a 500, `{"ok":false}`, or a body that is not JSON is unhealthy. The
// deployment script's own health step uses the same rule.
//
// It imports nothing from the app, so it cannot open the database or need
// the app's configuration.

// Covers the whole exchange: connect, headers AND body.
export const HEALTH_TIMEOUT_MS = 3000

// The server listens on 0.0.0.0 inside the container (Dockerfile ENV HOST),
// so loopback always reaches it.
export function healthUrl(source: NodeJS.ProcessEnv): string {
  return `http://127.0.0.1:${source.PORT || '3000'}/api/health`
}

// Returns null when healthy, otherwise the reason it is not.
export async function checkHealth(url: string, timeoutMs: number): Promise<string | null> {
  try {
    // The signal also aborts reading the body, so a server that sends
    // headers and then stalls still fails within the timeout. A redirect is
    // not followed: the health route never redirects, so one means something
    // else answered.
    const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) })
    const text = await res.text()
    if (res.status !== 200) return `status ${res.status}`
    let body: unknown
    try {
      body = JSON.parse(text)
    } catch {
      return 'body is not JSON'
    }
    if (typeof body !== 'object' || body === null || (body as { ok?: unknown }).ok !== true) {
      return 'ok is not exactly true'
    }
    return null
  } catch (err) {
    return err instanceof Error ? `${err.name}: ${err.message}` : String(err)
  }
}

// Run only when executed directly, not when imported by a test.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const reason = await checkHealth(healthUrl(process.env), HEALTH_TIMEOUT_MS)
  if (reason !== null) {
    console.error(`unhealthy: ${reason}`)
    process.exit(1)
  }
}
