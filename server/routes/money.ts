// Dollars <-> integer cents at the route boundary. The DB stores cents
// (REAL is the wrong tool for money and SQLite has no numeric(10,2)); the
// wire DTO speaks dollars. Shared by the gear-items and lists routes so the
// two cannot round differently - both accept gear costs, and a divergence
// would show up as a one-cent discrepancy nobody would trace.
//
// Callers must have validated through costSchema (shared/gear.ts) first: it
// caps magnitude and rejects more than 2 decimal places, which is what makes
// the multiply-and-round exact here.
export function dollarsToCents(cost: number | null): number | null {
  return cost === null ? null : Math.round(cost * 100)
}
