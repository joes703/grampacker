import { secureHeaders } from 'hono/secure-headers'
import type { AppEnv } from '../env'

// Hono's secureHeaders, on every response: SPA shell, static assets and API.
// Its defaults apply except where ours are stricter or specific to this app.
// Caddy proxies to the Node process and adds no headers (deploy/Caddyfile),
// so nothing in front of the app injects scripts or changes this policy.
const CSP = {
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'"],
  // Strict on purpose: React sets style={} props through the CSSOM
  // (element.style), which CSP does not block - 'unsafe-inline' is only
  // needed for parser-inserted style attributes and <style> tags, and the app
  // has neither.
  styleSrc: ["'self'"],
  imgSrc: ["'self'", 'data:', 'blob:'],
  connectSrc: ["'self'"],
  fontSrc: ["'self'", 'data:'],
  frameAncestors: ["'none'"],
  baseUri: ["'self'"],
  formAction: ["'self'"],
  manifestSrc: ["'self'"],
  workerSrc: ["'self'"],
}

// Built once per app (server/index.ts). In dev the CSP is left out: Vite's HMR
// client and the react-refresh preamble are inline scripts plus a websocket,
// which the production CSP blocks outright.
export function securityHeaders(dev: boolean) {
  return secureHeaders({
    contentSecurityPolicy: dev ? undefined : CSP,
    xFrameOptions: 'DENY',
    // Ignored by browsers over plain http, so harmless in dev.
    strictTransportSecurity: 'max-age=63072000; includeSubDomains; preload',
    referrerPolicy: 'strict-origin-when-cross-origin',
    permissionsPolicy: { camera: [], microphone: [], geolocation: [], payment: [] },
  })
}

// A localhost BETTER_AUTH_URL means local development. Fails CLOSED: an
// unparseable origin is treated as production, so the full header set
// (including CSP) applies.
export function isDevEnvironment(env: AppEnv): boolean {
  try {
    return new URL(env.BETTER_AUTH_URL).hostname === 'localhost'
  } catch {
    return false
  }
}
