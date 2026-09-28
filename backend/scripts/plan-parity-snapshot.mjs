// Snapshot AR balances + plan counts before/after the Phase 5 migration.
// Run: doppler run -- node scripts/plan-parity-snapshot.mjs > scripts/plan-parity-before.txt
//      (apply migration)
//      doppler run -- node scripts/plan-parity-snapshot.mjs > scripts/plan-parity-after.txt
//      diff scripts/plan-parity-before.txt scripts/plan-parity-after.txt   # patient_total lines must match

import pg from 'pg'

const u = process.env.DATABASE_URL
if (!u) throw new Error('DATABASE_URL missing')
const cleanUrl = u.replace(/([?&])sslmode=[^&]*/g, '$1').replace(/[?&]$/, '').replace(/\?&/, '?')
const client = new pg.Client({ connectionString: cleanUrl, ssl: { rejectUnauthorized: false } })

async function main() {
  await client.connect()

  const counts = await client.query(`
    SELECT
      (SELECT count(*)::int FROM payment_plans) AS plans,
      (SELECT count(*)::int FROM invoices WHERE type = 'plan_installment') AS installments,
      (SELECT count(*)::int FROM invoices WHERE type = 'plan_total') AS plan_totals,
      (SELECT count(*)::int FROM payment_allocations) AS allocations
  `)
  console.log('# counts')
  for (const [k, v] of Object.entries(counts.rows[0])) console.log(`count_${k}=${v}`)

  const schedTable = await client.query(
    `SELECT to_regclass('public.payment_plan_schedule_items') IS NOT NULL AS exists`
  )
  if (schedTable.rows[0].exists) {
    const si = await client.query('SELECT count(*)::int AS n FROM payment_plan_schedule_items')
    console.log(`count_schedule_items=${si.rows[0].n}`)
  }

  console.log('# patient_balances')
  const pb = await client.query(`
    SELECT patient_id::text AS pid, ar_balance::text AS bal
    FROM patient_balances
    ORDER BY patient_id
  `)
  for (const r of pb.rows) console.log(`pb_${r.pid}=${r.bal}`)

  console.log('# patient AR derived from non-archived open invoices')
  const der = await client.query(`
    SELECT
      "patientId"::text AS pid,
      COALESCE(SUM(balance), 0)::text AS bal
    FROM invoices
    WHERE status IN ('issued', 'partially_paid')
      AND COALESCE(archived, false) = false
    GROUP BY "patientId"
    ORDER BY "patientId"
  `)
  for (const r of der.rows) console.log(`der_${r.pid}=${r.bal}`)

  await client.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
