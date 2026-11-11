import { randomTempId } from './random-temp-id'

// The id of an optimistic row the server has not confirmed yet. Such a row is
// in the cache so it renders at once, but no server row has its id: any
// request that names it fails, and a reorder payload that includes it is
// rejected whole (server/repos/reorder.ts). Every row action, drag and reorder
// cohort must check isUnconfirmed before it sends an id.
//
// The prefix keeps the id outside the uuid shape the server mints, so it can
// never collide with a real row.
const PREFIX = 'temp-'

export function unconfirmedId(): string {
  return `${PREFIX}${randomTempId()}`
}

export function isUnconfirmed(id: string): boolean {
  return id.startsWith(PREFIX)
}

// The rows a picker may offer: an option naming an unconfirmed row would send
// its id with whatever the user saves.
export function confirmedRows<T extends { id: string }>(rows: T[]): T[] {
  return rows.filter((row) => !isUnconfirmed(row.id))
}
