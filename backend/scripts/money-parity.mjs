// money-parity.mjs — run before and after 0030 and diff the output.
// Usage: doppler run -- node scripts/money-parity.mjs > sums.before.txt
//        doppler run -- node scripts/money-parity.mjs > sums.after.txt
//        diff sums.before.txt sums.after.txt   # must be empty

import pg from 'pg'

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  console.error('DATABASE_URL is not set')
  process.exit(1)
}

const cleanUrl = DATABASE_URL.replace(/([?&])sslmode=[^&]*/g, '$1')
  .replace(/[?&]$/, '')
  .replace(/\?&/, '?')

const client = new pg.Client({ connectionString: cleanUrl, ssl: { rejectUnauthorized: false } })

// (table, [columns]) pairs we expect to be money columns.
const MONEY_COLUMNS = [
  ['invoices', ['amount', '"paidAmount"']],
  ['payments', ['amount', 'balance']],
  ['payment_plans', ['"originalAmount"', '"discountAmount"', '"totalAmount"', '"amountPerInstallment"']],
  ['payment_plan_templates', ['"totalAmount"', '"amountPerInstallment"']],
  ['expenses', ['amount']],
  ['daily_reports', ['"totalPayments"', '"totalExpenses"']],
  ['sales', ['"unitPrice"', '"costPrice"', '"totalAmount"', 'profit']],
  ['tax_calculations', ['"baseAmount"', '"nhilAmount"', '"getfundAmount"', '"levyBase"', '"vatAmount"', '"totalTax"', '"grossTotal"']],
  ['patient_wallets', ['"creditBalance"']],
  ['wallet_transactions', ['amount', '"balanceBefore"', '"balanceAfter"']],
  ['patient_timeline', ['amount']],
]

async function main() {
  await client.connect()

  console.log('# parity dump:', new Date().toISOString())

  for (const [table, cols] of MONEY_COLUMNS) {
    const exists = await client.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1`,
      [table]
    )
    if (exists.rowCount === 0) {
      console.log(`${table}: (table not present)`)
      continue
    }
    const sumExpr = cols
      .map((c) => `COALESCE(SUM(${c}::numeric), 0)::text AS sum_${c.replace(/"/g, '').toLowerCase()}`)
      .join(', ')
    const r = await client.query(`SELECT COUNT(*)::int AS row_count, ${sumExpr} FROM "${table}"`)
    const row = r.rows[0]
    // Print one line per table, columns alphabetised for stable diffs
    const out = Object.entries(row)
      .filter(([k]) => k !== 'row_count')
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join(' ')
    console.log(`${table}  rows=${row.row_count}  ${out}`)
  }

  await client.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
