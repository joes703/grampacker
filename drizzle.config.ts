import { defineConfig } from 'drizzle-kit'

// Generate-only config: `npx drizzle-kit generate` diffs the schema and
// emits SQL migrations into ./migrations, then
// `npx wrangler d1 migrations apply grampacker --local` applies them to the
// local D1. No Cloudflare credentials needed for the local loop.
export default defineConfig({
  schema: './server/db/schema.ts',
  out: './migrations',
  dialect: 'sqlite',
})
