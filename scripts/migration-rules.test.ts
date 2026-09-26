import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { forbiddenIn } from './migration-rules.mjs'

describe('forbiddenIn', () => {
  it("refuses drizzle-kit's table rebuild, whatever the case", () => {
    const rebuild = [
      'PRAGMA foreign_keys=OFF;',
      'CREATE TABLE `__new_lists` (`id` text PRIMARY KEY NOT NULL);',
      'INSERT INTO `__new_lists`("id") SELECT "id" FROM `lists`;',
      'drop table `lists`;',
      'ALTER TABLE `__new_lists` RENAME TO `lists`;',
    ].join('\n')
    expect(forbiddenIn(rebuild)).toHaveLength(4)
  })

  it('refuses renames and ledger or schema-table writes', () => {
    expect(forbiddenIn('ALTER TABLE `a` RENAME COLUMN `x` TO `y`;')).not.toEqual([])
    expect(forbiddenIn("DELETE FROM d1_migrations WHERE name = 'x';")).not.toEqual([])
    expect(forbiddenIn('UPDATE sqlite_master SET sql = 1;')).not.toEqual([])
  })

  it('allows additive changes and the removals that do not rebuild', () => {
    expect(forbiddenIn('ALTER TABLE `a` ADD `b` text;')).toEqual([])
    expect(forbiddenIn('ALTER TABLE `a` DROP COLUMN `b`;')).toEqual([])
    expect(forbiddenIn('DROP INDEX `a_idx`;\nDROP TRIGGER `a_cap`;')).toEqual([])
  })

  it('ignores words inside comments', () => {
    expect(forbiddenIn('-- never DROP TABLE here\n/* or RENAME */\nCREATE INDEX `i` ON `a` (`b`);')).toEqual([])
  })

  it('passes the baseline', () => {
    expect(forbiddenIn(readFileSync('migrations/0000_baseline.sql', 'utf8'))).toEqual([])
  })
})
