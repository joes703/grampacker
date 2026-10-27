import { openSqlite } from '../server/db'
import { applyMigrations } from '../server/db/migrate'

// The CURRENT definition of every table, index and trigger: the migrations
// applied by the real runner to an in-memory database, read back from
// sqlite_schema. SQLite keeps each object's statement as written (and updated
// by ALTER TABLE), so a later migration's change is what this returns. Tests
// use it to check the literals SQL copies from TypeScript (SQL cannot import
// a constant).

const stripComments = (sql: string) =>
  sql.replaceAll(/\/\*[\s\S]*?\*\//g, ' ').replaceAll(/--[^\n]*/g, ' ')

let definitions: Map<string, string> | undefined

const currentDefinitions = (): Map<string, string> => {
  if (definitions) return definitions
  const sqlite = openSqlite(':memory:')
  try {
    applyMigrations(sqlite)
    const rows = sqlite
      .prepare('select name, sql from sqlite_schema where sql is not null')
      .all() as { name: string; sql: string }[]
    definitions = new Map(rows.map((row) => [row.name, stripComments(row.sql)]))
  } finally {
    sqlite.close()
  }
  return definitions
}

export const definitionOf = (name: string): string => {
  const sql = currentDefinitions().get(name)
  if (sql === undefined) throw new Error(`no current definition for ${name}`)
  return sql
}
