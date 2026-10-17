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
    expect(forbiddenIn("DELETE FROM __drizzle_migrations WHERE hash = 'x';")).not.toEqual([])
    expect(forbiddenIn('UPDATE sqlite_master SET sql = 1;')).not.toEqual([])
  })

  it('allows additive changes and the removals that do not rebuild', () => {
    expect(forbiddenIn('ALTER TABLE `a` ADD `b` text;')).toEqual([])
    expect(forbiddenIn('ALTER TABLE `a` DROP COLUMN `b`;')).toEqual([])
    expect(forbiddenIn('DROP INDEX `a_idx`;\nDROP TRIGGER `a_cap`;')).toEqual([])
  })

  it('cannot be fooled by comment markers inside strings or identifiers', () => {
    expect(forbiddenIn("SELECT '--'; DROP TABLE lists;")).not.toEqual([])
    expect(forbiddenIn("SELECT '/*'; DROP TABLE lists; SELECT '*/';")).not.toEqual([])
    expect(forbiddenIn("SELECT 'it''s -- fine'; DROP TABLE lists;")).not.toEqual([])
    expect(forbiddenIn('SELECT "--"; DROP TABLE lists;')).not.toEqual([])
    expect(forbiddenIn("SELECT $p('); SELECT '--'; DROP TABLE victim; -- '")).not.toEqual([])
    expect(forbiddenIn('DROP/**/TABLE lists;')).not.toEqual([])
    expect(forbiddenIn('DROP -- x\nTABLE lists;')).not.toEqual([])
    expect(forbiddenIn('ALTER/* */TABLE lists RENAME TO b;')).not.toEqual([])
  })

  it('refuses however the name is quoted or qualified', () => {
    expect(forbiddenIn("DELETE FROM '__drizzle_migrations';")).not.toEqual([])
    expect(forbiddenIn('DELETE FROM "__drizzle_migrations";')).not.toEqual([])
    expect(forbiddenIn('ALTER TABLE main.lists RENAME TO lists2;')).not.toEqual([])
    expect(forbiddenIn('ALTER TABLE "li""sts" RENAME TO lists2;')).not.toEqual([])
    expect(forbiddenIn("ALTER TABLE 'lists' RENAME COLUMN a TO b;")).not.toEqual([])
    expect(forbiddenIn('alter table `lists` rename `a` to `b`;')).not.toEqual([])
    expect(forbiddenIn('ALTER TABLE "a;b" RENAME TO c;')).not.toEqual([])
  })

  it('does not treat an index or column NAMED rename as a rename', () => {
    expect(forbiddenIn('CREATE INDEX `rename` ON `lists` (`name`);')).toEqual([])
  })

  it('refuses a forbidden word even in a comment (nothing is stripped)', () => {
    expect(forbiddenIn('-- never DROP TABLE here\nCREATE INDEX `i` ON `a` (`b`);')).not.toEqual([])
  })

  it('passes the baseline', () => {
    expect(forbiddenIn(readFileSync('migrations/0000_baseline.sql', 'utf8'))).toEqual([])
  })
})
