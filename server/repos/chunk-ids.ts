// D1 allows at most 100 bound parameters per query
// (https://developers.cloudflare.com/d1/platform/limits/), and drizzle's
// inArray binds one parameter per id. Any statement carrying a DTO-sized
// id list (300-500 ids across this repo's bulk endpoints) must be split.
// 90 leaves headroom for the other bound values in the same statement
// (userId, timestamps, etc.). Chunked writes MUST go through db.batch so
// the split stays one transaction.
//
// Ownership PREchecks should not use this: select ALL of the user's owned
// ids with the single userId parameter and test membership in a JS Set
// instead (see ownsAllGearIds) - one query regardless of input size.
export const MAX_IDS_PER_STATEMENT = 90

export function chunkIds<T>(ids: T[], size = MAX_IDS_PER_STATEMENT): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < ids.length; i += size) {
    chunks.push(ids.slice(i, i + size))
  }
  return chunks
}
