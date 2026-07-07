// Drizzle schema. Empty at phase 0 on purpose - tables land with their
// owning phase (auth in phase 1, gear in phase 2, ...). drizzle-kit reads
// this file via drizzle.config.ts to generate SQL migrations.
export {}
