import { defineConfig } from 'drizzle-kit'

// Generate-only config: `npx drizzle-kit generate` diffs the schema and emits
// SQL migrations into ./migrations. The Node migration runner applies them to
// SQLite (`npm run db:migrate` locally; the deploy script in production).
export default defineConfig({
  schema: './server/db/schema.ts',
  out: './migrations',
  dialect: 'sqlite',
})
