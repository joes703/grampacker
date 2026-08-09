import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { LIST_ITEM_CAP, PACK_RANK_MAX } from '../shared/lists'
import { FOOD_ITEM_CAP } from '../shared/food'

// PACK_RANK_MAX and LIST_ITEM_CAP are declared once in shared/lists.ts, but two
// things outside TypeScript's reach hold copies of the same numbers:
//
//   * migration 0019's triggers, which are what the DATABASE actually enforces.
//     SQL cannot import a constant, so the values are literals there.
//   * the pack-rank audit workflow, which decides whether production is clean
//     enough for a migration to apply. Shell cannot import one either.
//
// Both carried a comment saying "keep this in step with shared/". A comment is
// not a mechanism - the `# v6` tag comment on a setup-node pin was wrong for a
// full release before anyone noticed. These tests are the mechanism.
//
// Note the direction of the guard. Migration 0019 has SHIPPED, so it is frozen
// and cannot be the thing that drifts. What this catches is someone changing
// PACK_RANK_MAX or LIST_ITEM_CAP in shared/lists.ts and leaving the deployed
// database enforcing the old bound - app and DB silently disagreeing about what
// a legal rank is, with no test failing.

const readRepoFile = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

// Strip `--` line comments and `/* */` blocks. Comments in 0019 discuss ranges
// in prose ("0009", "999999999", "1000000001"), and scanning those would fail
// the exact-set check below for no reason.
const stripSqlComments = (sql: string) =>
  sql.replaceAll(/\/\*[\s\S]*?\*\//g, ' ').replaceAll(/--[^\n]*/g, ' ')

// Only literals big enough to be one of our constants. 0 and 1 appear
// structurally (a range floor, a `count(*) > 1`) and carry no contract.
const significantNumbers = (text: string) =>
  new Set((text.match(/\d+/g) ?? []).map(Number).filter((n) => n >= 100))

describe('pack rank constants stay in step outside TypeScript', () => {
  it("migration 0019's triggers enforce exactly the bounds shared/lists.ts declares", () => {
    const sql = stripSqlComments(readRepoFile('migrations/0019_pack-rank-guard.sql'))

    // The three values 0019 is entitled to contain, derived rather than typed.
    // `PACK_RANK_MAX - LIST_ITEM_CAP` is the headroom floor: a cohort within
    // LIST_ITEM_CAP of the ceiling can overflow when a location delete appends
    // every orphan at base+i.
    expect(significantNumbers(sql)).toEqual(
      new Set([LIST_ITEM_CAP, PACK_RANK_MAX, PACK_RANK_MAX - LIST_ITEM_CAP]),
    )
  })

  it("migration 0022's cascade trigger uses exactly the ceiling shared/lists.ts declares", () => {
    const sql = stripSqlComments(readRepoFile('migrations/0022_food-pack-state.sql'))

    // 0022 is the EXPAND half: no range triggers, no indexes. The only
    // literal it is entitled to carry is PACK_RANK_MAX, in the cascade
    // trigger's offset-vs-dense decision. The enforcement literals
    // (FOOD_ITEM_CAP scratch band + the ceiling) live in 0023 and get their
    // own assertion when that migration ships.
    expect(significantNumbers(sql)).toEqual(new Set([PACK_RANK_MAX]))
  })

  it("migration 0023's food enforcement uses exactly the bounds shared/ declares", () => {
    const sql = stripSqlComments(readRepoFile('migrations/0023_food-pack-rank-enforcement.sql'))

    // The 0019 mirror for food: the ceiling, the FOOD_ITEM_CAP-wide scratch
    // band, and the SAFE floor - PACK_RANK_MAX minus the largest possible
    // UNION append (LIST_ITEM_CAP + FOOD_ITEM_CAP) - in the repair's dirty
    // predicate and its CASE guarantee.
    expect(significantNumbers(sql)).toEqual(
      new Set([
        FOOD_ITEM_CAP,
        PACK_RANK_MAX,
        PACK_RANK_MAX - LIST_ITEM_CAP - FOOD_ITEM_CAP,
      ]),
    )
  })

  it('the pack-rank audit workflow probes the bounds shared/lists.ts declares', () => {
    const workflow = readRepoFile('.github/workflows/audit-pack-ranks.yml')

    const ceiling = workflow.match(/^\s*pack_rank_max=(\d+)$/m)
    expect(ceiling, 'no `pack_rank_max=<number>` assignment found').not.toBeNull()
    expect(Number(ceiling?.[1])).toBe(PACK_RANK_MAX)

    const headroom = workflow.match(/(?<!food_)headroom_floor=\$\(\(\s*pack_rank_max - (\d+)\s*\)\)/)
    expect(headroom, 'no `headroom_floor=$(( pack_rank_max - <number> ))` found').not.toBeNull()
    expect(Number(headroom?.[1])).toBe(LIST_ITEM_CAP)

    // The 0022 food mirror: same ceiling, FOOD_ITEM_CAP-wide headroom.
    const foodHeadroom = workflow.match(/food_headroom_floor=\$\(\(\s*pack_rank_max - (\d+)\s*\)\)/)
    expect(foodHeadroom, 'no `food_headroom_floor=$(( pack_rank_max - <number> ))` found').not.toBeNull()
    expect(Number(foodHeadroom?.[1])).toBe(FOOD_ITEM_CAP)
  })
})
