// verify-phase6.mjs — assert Phase 6 invariants.
//   * bills / bill_lines / supplier_balances tables exist
//   * suppliers extended with tin + default_payment_terms_days
//   * bills CHECK constraints in place
//   * bill number sequence registered
//   * supplier_balances row exists for every supplier
//   * bills + suppliers permissions seeded
//   * AP control 2000 GL == sum(supplier_balances.ap_balance)
// Row-dependent checks SKIP when the relevant table is empty.

import { skipIfEmpty, verify } from './_verify-lib.mjs'

await verify([
  {
    label: 'bills + bill_lines + supplier_balances tables exist',
    fn: async (client) => {
      const r = await client.query(`
        SELECT count(*)::int AS n FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name IN ('bills', 'bill_lines', 'supplier_balances')
      `)
      return r.rows[0].n === 3
    },
  },
  {
    label: 'suppliers extended with tin + default_payment_terms_days',
    fn: async (client) => {
      const r = await client.query(`
        SELECT count(*)::int AS n FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'suppliers'
          AND column_name IN ('tin', 'default_payment_terms_days')
      `)
      return r.rows[0].n === 2
    },
  },
  {
    label: 'bills CHECK constraints in place',
    fn: async (client) => {
      const r = await client.query(`
        SELECT count(*)::int AS n FROM pg_constraint c
        JOIN pg_class t ON c.conrelid = t.oid
        WHERE t.relname = 'bills' AND c.contype = 'c'
          AND c.conname IN ('bills_status_check', 'bills_amounts_check')
      `)
      return r.rows[0].n === 2
    },
  },
  {
    label: 'bill number sequence registered',
    fn: async (client) => {
      const r = await client.query(`SELECT 1 FROM number_sequences WHERE sequence_key = 'bill'`)
      return r.rowCount === 1
    },
  },
  {
    label: 'supplier_balances row exists for every supplier',
    fn: async (client) => {
      const empty = await skipIfEmpty(client, 'suppliers', 'no suppliers to check')
      if (empty) return empty
      const r = await client.query(`
        SELECT count(*)::int AS n FROM suppliers s
        WHERE NOT EXISTS (SELECT 1 FROM supplier_balances sb WHERE sb.supplier_id = s.id)
      `)
      return r.rows[0].n === 0
    },
  },
  {
    label: 'bills + suppliers permissions seeded',
    fn: async (client) => {
      const r = await client.query(
        `SELECT count(*)::int AS n FROM permissions WHERE module IN ('bills', 'suppliers')`
      )
      return r.rows[0].n === 8
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
  {
    label: 'AP control account (2000) GL == sum(supplier_balances.ap_balance)',
    fn: async (client) => {
      // Both sides of this comparison are 0 on a fresh DB — that is a real
      // (correct) reconciliation, not a vacuous pass, so it is NOT skipped.
      const r = await client.query(`
        WITH gl AS (
          SELECT COALESCE(SUM(jl.credit - jl.debit), 0)::numeric(15, 2) AS bal
          FROM journal_lines jl
          JOIN accounts a ON a.id = jl.account_id
          WHERE a.code = '2000'
        ),
        sub AS (
          SELECT COALESCE(SUM(ap_balance), 0)::numeric(15, 2) AS bal FROM supplier_balances
        )
        SELECT (SELECT bal FROM gl) AS gl_bal, (SELECT bal FROM sub) AS sub_bal,
               ABS((SELECT bal FROM gl) - (SELECT bal FROM sub)) AS drift
      `)
      const drift = Number(r.rows[0].drift)
      if (drift > 0.005)
        console.log('   gl=', r.rows[0].gl_bal, 'sub=', r.rows[0].sub_bal, 'drift=', drift)
      return drift < 0.005
    },
  },
])
