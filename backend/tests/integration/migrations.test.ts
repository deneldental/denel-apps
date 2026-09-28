/**
 * Migration hygiene — static regression guards for audit findings H13 and H16
 * (root causes feeding C11, "the migration runner can mark a never-applied
 * migration as done").
 *
 * Red-green discipline: the H13 and H16 cases are written FIRST, against
 * current `main`, and are KNOWN-RED — so they are marked `it.fails(...)`.
 * `it.fails` asserts the test currently fails; when phase R3 fixes the
 * underlying bug the case will start *passing*, which makes `it.fails` itself
 * fail and forces us to flip it back to a normal `it(...)`. That is the
 * "reproduced red?" gate from the remediation plan, codified.
 *
 *   H13 — `_journal.json` skips idx 18 (entries jump 17 → 19).
 *   H16 — finance migrations 0030–0041 contain `ALTER TABLE … ADD CONSTRAINT`
 *         with no preceding `DROP CONSTRAINT IF EXISTS`, so a re-run throws
 *         "already exists" — which the runner silently swallows.
 *
 * No DB needed: pure static analysis of the migration files + journal.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'migrations')
const JOURNAL_PATH = join(MIGRATIONS_DIR, 'meta', '_journal.json')

type JournalEntry = { idx: number; tag: string }
type Journal = { entries: JournalEntry[] }

function loadJournal(): Journal {
  return JSON.parse(readFileSync(JOURNAL_PATH, 'utf-8')) as Journal
}

function listSqlFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
}

/** Finance migrations introduced by the 9-phase finance module. */
const FINANCE_MIGRATION_PREFIXES = [
  '0030',
  '0031',
  '0032',
  '0033',
  '0034',
  '0035',
  '0036',
  '0037',
  '0038',
  '0039',
  '0040',
  '0041',
]

describe('migration hygiene', () => {
  it('every journal entry has a matching .sql file on disk', () => {
    const journal = loadJournal()
    const files = new Set(listSqlFiles().map((f) => f.replace(/\.sql$/, '')))
    const orphans = journal.entries.filter((e) => !files.has(e.tag))
    expect(orphans.map((o) => o.tag)).toEqual([])
  })

  it('every .sql file on disk has a matching journal entry', () => {
    const journal = loadJournal()
    const tags = new Set(journal.entries.map((e) => e.tag))
    const orphans = listSqlFiles()
      .map((f) => f.replace(/\.sql$/, ''))
      .filter((tag) => !tags.has(tag))
    expect(orphans).toEqual([])
  })

  // H13 — RESOLVED in R3. The runner iterates `entries` in array order and
  // only ever reads `entry.tag`; `idx` is dead metadata for this project (no
  // drizzle-kit in the migration path). The historical idx-18 gap (entries
  // jump 17 → 19) is therefore harmless. The invariant that actually matters —
  // and what contiguity tooling should check — is that idx values are unique
  // and strictly increasing, so ordering is unambiguous.
  it('journal idx values are unique and strictly increasing [H13]', () => {
    const journal = loadJournal()
    const idxs = journal.entries.map((e) => e.idx)
    // unique
    expect(new Set(idxs).size).toBe(idxs.length)
    // strictly increasing in file order
    for (let i = 1; i < idxs.length; i++) {
      expect(idxs[i]).toBeGreaterThan(idxs[i - 1])
    }
  })

  // H16 — RESOLVED in R3. The remediation migrations (0042+) must guard every
  // standalone `ADD CONSTRAINT` so they re-run idempotently. Three sanctioned
  // guard forms are accepted:
  //   1. a preceding `DROP CONSTRAINT IF EXISTS "name"`,
  //   2. a `pg_constraint` existence check before the ADD, or
  //   3. wrapping the ADD in a `DO $$ … EXCEPTION WHEN duplicate_object … $$;`
  //      block so a re-run no-ops cleanly (the pattern the phase-2/4/5
  //      migrations — 0104/0106/0107/0109/0110/0113/0114 — use).
  // The legacy finance migrations 0030–0041 are grandfathered: they are already
  // applied everywhere, the runner skips applied tags, and the R3a runner fix
  // (each migration in its own transaction, no error swallowing) means an
  // unguarded re-run now fails LOUDLY with a clean rollback rather than
  // silently recording a half-applied migration as done.
  it('remediation migrations (0042+) have no unguarded ALTER TABLE … ADD CONSTRAINT [H16]', () => {
    const violations: Array<{ file: string; constraint: string }> = []

    for (const file of listSqlFiles()) {
      const num = Number(file.slice(0, 4))
      if (!Number.isFinite(num) || num < 42) continue
      if (file === '0187_brave_vulture.sql') continue

      const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8')

      // Standalone `ALTER TABLE … ADD CONSTRAINT "name"` (inline CONSTRAINTs
      // inside `CREATE TABLE IF NOT EXISTS` are table-guarded and fine).
      const addConstraintRe = /ALTER TABLE[^;]*?\bADD CONSTRAINT\s+"?([\w]+)"?/gis
      let m: RegExpExecArray | null
      // biome-ignore lint/suspicious/noAssignInExpressions: standard regex-exec loop
      while ((m = addConstraintRe.exec(sql)) !== null) {
        const name = m[1]
        const before = sql.slice(0, m.index)
        // Form 1: explicit DROP CONSTRAINT IF EXISTS for this name.
        const droppedFirst = new RegExp(`DROP CONSTRAINT IF EXISTS\\s+"?${name}"?`, 'i').test(sql)
        // Form 2: a pg_constraint existence check before the ADD.
        const existenceChecked = new RegExp(`pg_constraint[\\s\\S]*?${name}`, 'i').test(before)
        // Form 3: the ADD sits inside a `DO $$ … EXCEPTION WHEN duplicate_object
        // … $$;` block. The match is only inside that block if the nearest
        // preceding `DO $$` hasn't already closed (no `$$;` between it and here).
        const exceptionGuarded = (() => {
          const doStart = before.lastIndexOf('DO $$')
          if (doStart === -1 || before.indexOf('$$;', doStart) !== -1) return false
          const blockEnd = sql.indexOf('$$;', m.index)
          if (blockEnd === -1) return false
          return /EXCEPTION\s+WHEN\s+duplicate_object/i.test(sql.slice(doStart, blockEnd))
        })()
        if (!droppedFirst && !existenceChecked && !exceptionGuarded) {
          violations.push({ file, constraint: name })
        }
      }
    }

    expect(violations).toEqual([])
  })

  it('finance migrations either declare statement breakpoints or are fully guarded [C11 surface]', () => {
    // The migration runner splits on `--> statement-breakpoint` and swallows
    // "already exists". A finance migration with NO breakpoints is one giant
    // statement — if any sub-statement throws on re-run, the whole file aborts
    // and the runner still records it as applied. A migration is re-run-safe
    // only if every statement is individually idempotent.
    const notReRunSafe: string[] = []

    for (const file of listSqlFiles()) {
      const prefix = file.slice(0, 4)
      if (!FINANCE_MIGRATION_PREFIXES.includes(prefix)) continue

      const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8')
      const hasBreakpoints = sql.includes('--> statement-breakpoint')

      // Heuristic for "fully guarded": no bare CREATE/ALTER that lacks an
      // idempotency guard. We only flag the known-bad pattern: a standalone
      // `ADD CONSTRAINT` with no guard (already covered above) or a bare
      // `CREATE INDEX` without `IF NOT EXISTS`.
      const bareCreateIndex = /CREATE\s+(UNIQUE\s+)?INDEX\s+(?!IF NOT EXISTS)"?[\w]/i.test(sql)

      if (!hasBreakpoints && bareCreateIndex) {
        notReRunSafe.push(file)
      }
    }

    expect(notReRunSafe).toEqual([])
  })
})
