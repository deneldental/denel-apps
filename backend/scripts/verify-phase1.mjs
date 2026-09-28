// verify-phase1.mjs — assert the Phase 1 invariants hold on the DB.
//   * All finance money columns are numeric (not real)
//   * CoA seeded with all expected accounts
//   * One open accounting_period covers today
//   * No unbalanced journal entries (SKIPs when there are none yet)

import { skipIfEmpty, verify } from './_verify-lib.mjs'

const FINANCE_TABLES = [
  'invoices',
  'payments',
  'payment_plans',
  'payment_plan_templates',
  'expenses',
  'daily_reports',
  'sales',
  'tax_calculations',
  'patient_wallets',
  'wallet_transactions',
]

await verify([
  {
    label: 'no real money columns remain in finance tables',
    fn: async (client) => {
      const r = await client.query(
        `SELECT table_name, column_name
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND data_type = 'real'
           AND table_name = ANY($1)`,
        [FINANCE_TABLES]
      )
      if (r.rows.length > 0) {
        for (const row of r.rows) console.log('   leftover:', row.table_name, row.column_name)
        return false
      }
      return true
    },
  },
  {
    label: 'accounts table exists',
    fn: async (client) => {
      const r = await client.query(
        `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='accounts'`
      )
      return r.rowCount === 1
    },
  },
  {
    label: 'CoA seeded (>= 30 accounts, includes 1200 + 2200)',
    fn: async (client) => {
      const total = await client.query('SELECT count(*)::int AS n FROM accounts')
      const ar = await client.query(`SELECT 1 FROM accounts WHERE code='1200' AND is_control=true`)
      const dep = await client.query(`SELECT 1 FROM accounts WHERE code='2200' AND is_control=true`)
      return total.rows[0].n >= 30 && ar.rowCount === 1 && dep.rowCount === 1
    },
  },
  {
    label: 'current month period is open',
    fn: async (client) => {
      const r = await client.query(`
        SELECT id, status FROM accounting_periods
        WHERE start_date <= CURRENT_DATE AND end_date >= CURRENT_DATE
      `)
      if (r.rowCount === 0) return false
      return r.rows.some((row) => row.status === 'open')
    },
  },
  {
    label: 'number_sequences seeded (>= 7 keys)',
    fn: async (client) => {
      const r = await client.query('SELECT count(*)::int AS n FROM number_sequences')
      return r.rows[0].n >= 7
    },
  },
  {
    label: 'no unbalanced journal entries',
    fn: async (client) => {
      const empty = await skipIfEmpty(client, 'journal_lines', 'no journal entries posted yet')
      if (empty) return empty
      const r = await client.query(`
        SELECT entry_id, SUM(debit) AS d, SUM(credit) AS c
        FROM journal_lines
        GROUP BY entry_id
        HAVING SUM(debit) <> SUM(credit)
      `)
      if (r.rows.length > 0) {
        for (const row of r.rows) console.log('   unbalanced:', row.entry_id, row.d, row.c)
      }
      return r.rowCount === 0
    },
  },
  {
    label: 'new permissions seeded',
    fn: async (client) => {
      const r = await client.query(
        `SELECT count(*)::int AS n FROM permissions
         WHERE module IN ('accounts','journal_entries','periods')`
      )
      return r.rows[0].n === 12
    },
  },
])
