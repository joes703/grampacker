import type { Db } from '../db'
import { createFoodRepo } from './food'
import { createCategoriesRepo } from './categories'
import { createGearItemsRepo } from './gear-items'
import { createListItemsRepo } from './list-items'
import { createListsRepo } from './lists'
import { createPackingLocationsRepo } from './packing-locations'
import { createUsersRepo } from './users'

// The ONLY constructor of user-scoped data access. The session middleware
// builds this and hands it to handlers; every repo method is pre-filtered
// by userId, so a handler cannot express a cross-user query. Handlers never
// import the DB factory or schema (the boundary in eslint.config.js
// enforces this; the repository layer is the sole importer).
export function reposForUser(db: Db, userId: string) {
  return {
    users: createUsersRepo(db, userId),
    categories: createCategoriesRepo(db, userId),
    gearItems: createGearItemsRepo(db, userId),
    food: createFoodRepo(db, userId),
    lists: createListsRepo(db, userId),
    listItems: createListItemsRepo(db, userId),
    packingLocations: createPackingLocationsRepo(db, userId),
  }
}

export type UserRepos = ReturnType<typeof reposForUser>
