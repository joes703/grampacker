import { readFileSync, readdirSync } from 'node:fs'

// The CURRENT definition of every table, index and trigger, read from the
// migration files in apply order: a later CREATE replaces an earlier one and a
// DROP removes it. Tests use this to check the literals SQL copies from
// TypeScript (SQL cannot import a constant).
const dir = new URL('../migrations/', import.meta.url)

const stripComments = (sql: string) =>
  sql.replaceAll(/\/\*[\s\S]*?\*\//g, ' ').replaceAll(/--[^\n]*/g, ' ')

const currentDefinitions = (): Map<string, string> => {
  const files = readdirSync(dir)
    .filter((name) => /^\d+_.*\.sql$/.test(name))
    .sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10))
  const defs = new Map<string, string>()
  for (const file of files) {
    const sql = stripComments(readFileSync(new URL(file, dir), 'utf8'))
    const pattern = /\b(CREATE\s+(?:UNIQUE\s+)?(TABLE|INDEX|TRIGGER)|DROP\s+(TABLE|INDEX|TRIGGER))\s+(?:IF\s+(?:NOT\s+)?EXISTS\s+)?[`"]?(\w+)/gi
    for (const match of sql.matchAll(pattern)) {
      const [, verb = '', createKind, , name = ''] = match
      if (verb.toUpperCase().startsWith('DROP')) {
        defs.delete(name)
        continue
      }
      const start = match.index
      const end = createKind?.toUpperCase() === 'TRIGGER'
        ? sql.slice(start).search(/\bEND\s*;/i) + start
        : sql.indexOf(';', start)
      defs.set(name, sql.slice(start, end))
    }
  }
  return defs
}

export const definitionOf = (name: string): string => {
  const sql = currentDefinitions().get(name)
  if (sql === undefined) throw new Error(`no current definition for ${name}`)
  return sql
}
