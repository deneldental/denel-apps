/**
 * One-shot repair: strip credentials already written to `audit_logs`.
 *
 * `routes/users.ts` passed the raw request body as `changes` on user-create and
 * on admin-password-set, and `createAuditLog` stored it verbatim. Every account
 * provisioned or password-reset through the portal therefore left its CLEARTEXT
 * password in a table that `/api/audit-logs` serves to anyone holding the
 * audit-logs read permission — and it survives every later rotation.
 *
 * The write path is fixed (`redactSecrets` in `lib/audit.ts`). This repairs the
 * rows that predate the fix. It rewrites `changes`, `beforeJson` and `afterJson`
 * in place, replacing secret-named values with the same marker the live path
 * now uses. Nothing is deleted: the audit trail keeps saying that a password was
 * set, only the value goes.
 *
 * USAGE — dry run first, always:
 *
 *   pnpm --filter backend audit:purge-secrets            # report only
 *   pnpm --filter backend audit:purge-secrets --apply    # write
 *
 * Point DATABASE_URL at the instance you mean to repair. Run it against
 * production only with a fresh backup in hand — it is an UPDATE over a table
 * whose whole purpose is to be tamper-evident, so do it once, deliberately, and
 * record that you did.
 */

import { sql } from 'drizzle-orm'
import { getDb } from '../db'
import { auditLogs } from '../db/schema'
import { redactSecrets } from '../lib/audit'

type JsonRecord = Record<string, unknown>

const APPLY = process.argv.includes('--apply')

function changed(before: unknown, after: unknown): boolean {
  return JSON.stringify(before) !== JSON.stringify(after)
}

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set')
  const db = getDb(url)

  console.log(`[purge-audit-secrets] mode: ${APPLY ? 'APPLY (writes)' : 'DRY RUN (no writes)'}`)

  const rows = await db
    .select({
      id: auditLogs.id,
      changes: auditLogs.changes,
      beforeJson: auditLogs.beforeJson,
      afterJson: auditLogs.afterJson,
    })
    .from(auditLogs)

  let affected = 0
  for (const row of rows) {
    const next = {
      changes: row.changes ? redactSecrets(row.changes as JsonRecord) : row.changes,
      beforeJson: row.beforeJson ? redactSecrets(row.beforeJson as JsonRecord) : row.beforeJson,
      afterJson: row.afterJson ? redactSecrets(row.afterJson as JsonRecord) : row.afterJson,
    }

    const dirty =
      changed(row.changes, next.changes) ||
      changed(row.beforeJson, next.beforeJson) ||
      changed(row.afterJson, next.afterJson)

    if (!dirty) continue
    affected++

    // Deliberately no value printed — reporting what was found would reproduce
    // the leak in a terminal and a shell history.
    console.log(`  row ${row.id}: secret-bearing field(s) present`)

    if (APPLY) {
      await db.update(auditLogs).set(next).where(sql`${auditLogs.id} = ${row.id}`)
    }
  }

  console.log(
    `[purge-audit-secrets] scanned ${rows.length} rows, ${affected} needed redaction` +
      (APPLY ? ' — written.' : ' — nothing written (re-run with --apply).')
  )

  if (!APPLY && affected > 0) {
    console.log(
      '\nNOTE: redacting the row does not un-leak the password. Any account whose\n' +
        'credential appears here should be rotated as well.'
    )
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[purge-audit-secrets] failed:', err)
    process.exit(1)
  })
