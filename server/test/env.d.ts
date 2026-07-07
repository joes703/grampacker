// Test-only binding injected by vitest.workers.config.ts. Declared optional
// so the production Env type is not misrepresented; apply-migrations.ts
// asserts its presence at runtime.
declare namespace Cloudflare {
  interface Env {
    TEST_MIGRATIONS?: import('cloudflare:test').D1Migration[]
  }
}
