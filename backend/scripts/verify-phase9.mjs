// verify-phase9.mjs — assert Phase 9 invariants.
//   * 2400 Deferred Revenue account seeded
//   * invoice_lines.defer_revenue column exists
//   * revenue_recognition_events table exists with CHECK constraints
//   * No recognition event exceeds its line balance
//   * 2400 GL balance == sum(remaining deferred per line)
//   * No unbalanced journal entries
// Row-dependent checks SKIP when the relevant table is empty.

import { skipIfEmpty, verify } from './_verify-lib.mjs'

await verify([
  {
    label: '2400 Deferred Revenue account seeded',
    fn: async (client) => {
      const r = await client.query(
        `SELECT 1 FROM accounts WHERE code = '2400' AND type = 'liability' AND normal_balance = 'credit'`
      )
      return r.rowCount === 1
    },
  },
  {
    label: 'invoice_lines.defer_revenue column exists',
    fn: async (client) => {
      const r = await client.query(`
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'invoice_lines'
          AND column_name = 'defer_revenue'
      `)
      return r.rowCount === 1
    },
  },
  {
    label: 'revenue_recognition_events table exists with CHECK constraints',
    fn: async (client) => {
      const r = await client.query(`
        SELECT count(*)::int AS n FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'revenue_recognition_events'
      `)
      if (r.rows[0].n !== 1) return false
      const c = await client.query(`
        SELECT count(*)::int AS n FROM pg_constraint c
        JOIN pg_class t ON c.conrelid = t.oid
        WHERE t.relname = 'revenue_recognition_events'
          AND c.conname IN ('revenue_recognition_trigger_check', 'revenue_recognition_amount_check')
      `)
      return c.rows[0].n === 2
    },
  },
  {
    label: 'no recognition event exceeds its line balance',
    fn: async (client) => {
      const empty = await skipIfEmpty(
        client,
        'revenue_recognition_events',
        'no recognition events yet'
      )
      if (empty) return empty
      const r = await client.query(`
        SELECT il.id
        FROM invoice_lines il
        WHERE il.defer_revenue = true
          AND COALESCE((
            SELECT SUM(amount)
            FROM revenue_recognition_events re
            WHERE re.invoice_line_id = il.id AND re.reversed IS NULL
          ), 0) > il.line_after_discount + 0.01
      `)
      return r.rowCount === 0
    },
  },
  {
    label: '2400 GL balance == sum(remaining deferred per line)',
    fn: async (client) => {
      // Both sides are 0 on a fresh DB — a correct reconciliation, not vacuous.
      const r = await client.query(`
        WITH gl AS (
          SELECT COALESCE(SUM(jl.credit - jl.debit), 0)::numeric(15, 2) AS bal
          FROM journal_lines jl
          JOIN accounts a ON a.id = jl.account_id
          WHERE a.code = '2400'
        ),
        remaining AS (
          SELECT COALESCE(SUM(
            il.line_after_discount - COALESCE((
              SELECT SUM(amount) FROM revenue_recognition_events re
              WHERE re.invoice_line_id = il.id AND re.reversed IS NULL
            ), 0)
          ), 0)::numeric(15, 2) AS bal
          FROM invoice_lines il
          JOIN invoices i ON i.id = il.invoice_id
          WHERE il.defer_revenue = true
            AND i.archived = false
            AND i.status IN ('issued', 'partially_paid', 'paid')
        )
        SELECT (SELECT bal FROM gl) AS gl, (SELECT bal FROM remaining) AS sub,
               ABS((SELECT bal FROM gl) - (SELECT bal FROM remaining)) AS drift
      `)
      const drift = Number(r.rows[0].drift)
      if (drift > 0.005) console.log('   gl=', r.rows[0].gl, 'sub=', r.rows[0].sub, 'drift=', drift)
      return drift < 0.005
    },
  },
  {
    label: 'no unbalanced journal entries',
    fn: async (client) => {
      const empty = await skipIfEmpty(client, 'journal_lines', 'no journal entries posted yet')
      if (empty) return empty
      const r = await client.query(`
        SELECT entry_id FROM journal_lines GROUP BY entry_id HAVING SUM(debit) <> SUM(credit)
      `)
      return r.rowCount === 0
    },
  },
])
