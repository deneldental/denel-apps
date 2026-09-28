/**
 * One-off cleanup: removes leaked integration-test fixtures.
 *
 * The C3/H6 concurrency tests use committed fixtures (patient name prefixed
 * `IT `) and delete them in a `finally`. If a test run is *aborted* (e.g. a
 * timeout kills it mid-flight) that `finally` never runs and the patient
 * leaks. This script finds every `IT %` patient, deletes the journal entries
 * its invoices/payments produced (those don't cascade), then deletes the
 * patient (which cascades invoices/payments/allocations/wallets/balances).
 *
 * Safe to run repeatedly. Touches ONLY rows whose patient name starts `IT `.
 */
import { Pool } from 'pg'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL is required (run via `doppler run --`)')
  process.exit(1)
}
const pool = new Pool({
  connectionString: url.replace(/([?&])sslmode=[^&]*/g, '$1').replace(/[?&]$/, ''),
  ssl: { rejectUnauthorized: false },
})

const client = await pool.connect()
try {
  const { rows: patients } = await client.query(
    `SELECT id, name FROM patients WHERE name LIKE 'IT %'`
  )
  if (patients.length === 0) {
    console.log('No leaked IT fixtures found — nothing to clean.')
    process.exit(0)
  }
  console.log(`Found ${patients.length} leaked IT patient(s):`, patients.map((p) => p.name))

  const patientIds = patients.map((p) => p.id)
  // Journal entries are produced via invoices (source_doc_id) and payments
  // (source_doc_id), plus their reversals. Collect every entry traceable to
  // these patients' documents.
  const { rows: docs } = await client.query(
    `SELECT id FROM invoices WHERE "patientId" = ANY($1::uuid[])
     UNION
     SELECT id FROM payments WHERE "patientId" = ANY($1::uuid[]) OR party_id = ANY($1::uuid[])`,
    [patientIds]
  )
  const docIds = docs.map((d) => d.id)

  await client.query('BEGIN')
  if (docIds.length > 0) {
    // Entries directly sourced from these docs, plus reversals of those entries.
    const { rows: entries } = await client.query(
      `SELECT id FROM journal_entries WHERE source_doc_id = ANY($1::uuid[])`,
      [docIds]
    )
    const entryIds = entries.map((e) => e.id)
    if (entryIds.length > 0) {
      const { rows: reversals } = await client.query(
        `SELECT id FROM journal_entries WHERE reverses_entry_id = ANY($1::uuid[])`,
        [entryIds]
      )
      const allEntryIds = [...new Set([...entryIds, ...reversals.map((r) => r.id)])]
      await client.query(`DELETE FROM journal_lines WHERE entry_id = ANY($1::uuid[])`, [
        allEntryIds,
      ])
      await client.query(
        `UPDATE journal_entries SET reverses_entry_id = NULL WHERE reverses_entry_id = ANY($1::uuid[])`,
        [allEntryIds]
      )
      await client.query(`DELETE FROM journal_entries WHERE id = ANY($1::uuid[])`, [allEntryIds])
      console.log(`Deleted ${allEntryIds.length} journal entr(ies).`)
    }
  }
  const del = await client.query(`DELETE FROM patients WHERE id = ANY($1::uuid[])`, [patientIds])
  await client.query('COMMIT')
  console.log(`Deleted ${del.rowCount} patient(s) and all cascaded finance rows. Done.`)
} catch (err) {
  await client.query('ROLLBACK')
  console.error('Cleanup failed, rolled back:', err)
  process.exit(1)
} finally {
  client.release()
  await pool.end()
}
