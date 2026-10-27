/**
 * One-off repair behind `pnpm --filter backend sms:purge-secrets`: delete rows
 * already in `sms_messages` that carry a login/reset/registration code or a
 * tokenised confirmation link, from before those messages were redacted at
 * write time (lib/sms-redaction.ts). See F01 / D1 in
 * project-docs/DENEL_FRAMADA_AUDIT_2026-10-25.md. The owner chose deletion over
 * redaction (2026-10-26).
 *
 * Returns counts only. Printing the matched messages would reproduce the leak in
 * a terminal and a shell history.
 */
import { inArray, like, or, sql } from 'drizzle-orm'
import type { DB } from '../db'
import { smsMessages } from '../db/schema'
import { looksLikeHistoricalSensitiveSms } from './sms-redaction'

export interface PurgeResult {
  /** Rows examined (those that could contain a code or a link). */
  scanned: number
  /** Rows recognised as credential-bearing. */
  matched: number
  /** Rows deleted; always 0 on a dry run. */
  deleted: number
}

const DELETE_CHUNK = 500

export async function purgeSensitiveSms(db: DB, opts: { apply: boolean }): Promise<PurgeResult> {
  // A cheap SQL pre-filter keeps a large table from being read into memory; the
  // precise patterns then run in JS, in one place, so the SQL cannot drift from them.
  const candidates = await db
    .select({ id: smsMessages.id, content: smsMessages.content })
    .from(smsMessages)
    .where(or(sql`${smsMessages.content} ILIKE '% code is %'`, like(smsMessages.content, '%/c/%')))

  const ids = candidates
    .filter((row) => looksLikeHistoricalSensitiveSms(row.content))
    .map((row) => row.id)

  let deleted = 0
  if (opts.apply) {
    for (let i = 0; i < ids.length; i += DELETE_CHUNK) {
      const chunk = ids.slice(i, i + DELETE_CHUNK)
      await db.delete(smsMessages).where(inArray(smsMessages.id, chunk))
      deleted += chunk.length
    }
  }
  return { scanned: candidates.length, matched: ids.length, deleted }
}
