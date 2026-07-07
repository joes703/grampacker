import type { Db } from '../db'
import { createUsersRepo } from './users'

// The ONLY constructor of user-scoped data access. The session middleware
// builds this and hands it to handlers; every repo method is pre-filtered
// by userId, so a handler cannot express a cross-user query. Handlers never
// import the DB factory or schema (ESLint boundary enforces this in a
// follow-up; the repository layer is the sole importer).
export function reposForUser(db: Db, userId: string) {
  return {
    users: createUsersRepo(db, userId),
  }
}

export type UserRepos = ReturnType<typeof reposForUser>
