import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'
import { user, session, verification, passkey } from './auth-schema'

// The model better-auth's adapter is given at RUNTIME. It differs from the
// CLI-generated auth-schema.ts in exactly one place: no `account.issuer`.
//
// Why this file exists
// --------------------
// better-auth 1.7.0-1.7.2 required an `account.issuer` column; migration 0028
// added it NOT NULL with a unique index. 1.7.3 REVERTED that column and, in
// the same release, turned schema validation on by default in production. The
// validator's `unexpected-required-column` rule rejects a NOT NULL column with
// no default that better-auth never writes - and it runs before every
// /api/auth/* dispatch, so on 1.7.4 the generated-vs-physical mismatch would
// block ALL auth, not just the paths that touch `account`.
//
// The column cannot be dropped in the same release that stops reading it:
// deploy.yml applies migrations and THEN swaps the Worker, so the OLD Worker
// runs against the NEW schema for the length of that gap (AGENTS.md, "DROP
// COLUMN ... as a CONTRACT STEP"). So Release A stops reading the column and
// Release B removes it. THIS FILE IS DELETED IN RELEASE B, when auth-schema.ts
// is regenerated issuer-free and becomes the only auth model again.
//
// Why an override is enough, and why there is still one Drizzle instance
// ---------------------------------------------------------------------
// `drizzleAdapter`'s `schema` option wins over the instance's own schema
// wherever it is consulted:
//   - @better-auth/drizzle-adapter 1.7.4 index.mjs:59
//       `const schema = config.schema || db._.fullSchema`
//     feeds every builder path (`db.select().from(schemaModel)`), and
//   - index.mjs:572
//       `findDrizzleSchemaProblems(config.schema ?? db._?.fullSchema ?? {}, ...)`
//     is what the validator inspects, so an issuer-free model here disarms the
//     mismatch WITHOUT `advanced.database.validateSchema: false`. The validator
//     stays armed for user/session/verification/passkey.
//
// The one path that would bypass this override is the relational one
// (`db.query[model].findFirst/findMany`, index.mjs:316,373), which reads the
// drizzle instance's OWN schema - the full, issuer-carrying one. It is reached
// only when the adapter is handed a `join`, and core suppresses that unless
// `advanced.database.joins` is enabled:
//   @better-auth/core factory.mjs:562,610
//     `if (!options.advanced?.database?.joins && join && ...) passJoinToAdapter = false`
//   factory.mjs:577
//     `join: passJoinToAdapter ? join : void 0`
// We do not enable it (server/auth.ts, `advanced`), so the adapter never sees a
// join and the relational path is unreachable. That is why a SECOND drizzle()
// instance is unnecessary and server/db/index.ts stays the single entry point.
//
// Load-bearing consequence: do NOT enable `advanced.database.joins` while this
// file exists. Doing so would route account reads through the full model and
// re-introduce `issuer` into the SQL. server/auth-account-sql.test.ts asserts
// on the wire that no statement names the column.
//
// Everything except `account` is re-exported from auth-schema.ts rather than
// redeclared, so those four models cannot drift from the generated file.
export { user, session, verification, passkey }

export const account = sqliteTable(
  'account',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: integer('access_token_expires_at', {
      mode: 'timestamp_ms',
    }),
    refreshTokenExpiresAt: integer('refresh_token_expires_at', {
      mode: 'timestamp_ms',
    }),
    scope: text('scope'),
    password: text('password'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index('account_userId_idx').on(table.userId)],
)
