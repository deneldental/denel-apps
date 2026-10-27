/**
 * One-shot repair: delete credential-bearing rows from `sms_messages`.
 *
 * Before 2026-10-26 every SMS was stored in full, so the table holds staff and
 * patient login/reset/registration codes and tokenised appointment-confirmation
 * links in clear text. New messages are redacted at write time
 * (lib/sms-redaction.ts); this removes the ones that predate that. Rows are
 * DELETED, not rewritten (decision D1 in
 * project-docs/DENEL_FRAMADA_AUDIT_2026-10-25.md).
 *
 * USAGE — dry run first, always:
 *
 *   pnpm --filter backend sms:purge-secrets            # count only
 *   pnpm --filter backend sms:purge-secrets --apply    # delete
 *
 * Point DATABASE_URL at the instance you mean to repair. Against a database you
 * care about, take a backup first. Deleting the rows does not un-leak a code
 * that was already read: codes expire after 10 minutes, but a confirmation link
 * token stays valid until its appointment is resent or changes.
 */
import { getDb } from '../db'
import { purgeSensitiveSms } from '../lib/sms-purge'

const APPLY = process.argv.includes('--apply')

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set')

  console.log(`[sms:purge-secrets] mode: ${APPLY ? 'APPLY (deletes rows)' : 'DRY RUN (no writes)'}`)
  const { scanned, matched, deleted } = await purgeSensitiveSms(getDb(url), { apply: APPLY })

  // Counts only: printing the messages would reproduce the leak in a terminal.
  console.log(
    `[sms:purge-secrets] examined ${scanned} candidate row(s), ${matched} carry a code or private link` +
      (APPLY ? `, ${deleted} deleted.` : ' — nothing deleted (re-run with --apply).')
  )
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[sms:purge-secrets] failed:', err)
    process.exit(1)
  })
