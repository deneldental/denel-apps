// verify-phase7.mjs — assert Phase 7 invariants.
//   * specialist_commissions / specialist_payouts / specialist_balances tables exist
//   * commissions permissions seeded
//   * payout number sequence registered
//   * specialist_balances row exists for every specialist
//   * stored commission_amount is backed by the GL 5110 expense account
//     (independent cross-check — NOT a re-derivation of the impl formula)
//   * payable_amount never exceeds commission_amount
//   * AP control 2100 GL == sum(specialist_balances.accrued + payable)
// Row-dependent checks SKIP when the relevant table is empty.

import { skipIfEmpty, verify } from './_verify-lib.mjs'

await verify([
  {
    label: 'three commission tables exist',
    fn: async (client) => {
      const r = await client.query(`
        SELECT count(*)::int AS n FROM information_schema.tables
        WHERE table_schema='public'
          AND table_name IN ('specialist_commissions', 'specialist_payouts', 'specialist_balances')
      `)
      return r.rows[0].n === 3
    },
  },
  {
    label: 'commissions permissions seeded',
    fn: async (client) => {
      const r = await client.query(
        `SELECT count(*)::int AS n FROM permissions WHERE module = 'commissions'`
      )
      return r.rows[0].n === 4
    },
  },
  {
    label: 'payout number sequence registered',
    fn: async (client) => {
      const r = await client.query(`SELECT 1 FROM number_sequences WHERE sequence_key = 'payout'`)
      return r.rowCount === 1
    },
  },
  {
    label: 'specialist_balances row exists for every specialist',
    fn: async (client) => {
      const empty = await skipIfEmpty(client, 'specialists', 'no specialists to check')
      if (empty) return empty
      const r = await client.query(`
        SELECT count(*)::int AS n FROM specialists s
        WHERE NOT EXISTS (SELECT 1 FROM specialist_balances sb WHERE sb.specialist_id = s.id)
      `)
      return r.rows[0].n === 0
    },
  },
  {
    // Audit H4: the previous check re-derived `gross * rate / 100` and compared
    // to the stored value — a rounding bug drifts both together and the check
    // still passes. This instead ties the stored commission amounts to an
    // INDEPENDENT ledger fact: the total ever debited to 5110 Specialist
    // Commission Expense must equal the sum of non-reversed commission_amounts.
    label: 'stored commission_amount reconciles to GL 5110 expense',
    fn: async (client) => {
      const empty = await skipIfEmpty(
        client,
        'specialist_commissions',
        'no commissions accrued yet'
      )
      if (empty) return empty
      const r = await client.query(`
        WITH gl AS (
          SELECT COALESCE(SUM(jl.debit - jl.credit), 0)::numeric(15, 2) AS bal
          FROM journal_lines jl
          JOIN accounts a ON a.id = jl.account_id
          WHERE a.code = '5110'
        ),
        rows AS (
          SELECT COALESCE(SUM(commission_amount), 0)::numeric(15, 2) AS total
          FROM specialist_commissions
          WHERE status <> 'reversed'
        )
        SELECT (SELECT bal FROM gl) AS gl_bal, (SELECT total FROM rows) AS rows_total,
               ABS((SELECT bal FROM gl) - (SELECT total FROM rows)) AS drift
      `)
      const drift = Number(r.rows[0].drift)
      if (drift > 0.005)
        console.log('   5110 gl=', r.rows[0].gl_bal, 'rows=', r.rows[0].rows_total, 'drift=', drift)
      return drift < 0.005
    },
  },
  {
    label: 'payable_amount never exceeds commission_amount',
    fn: async (client) => {
      const empty = await skipIfEmpty(
        client,
        'specialist_commissions',
        'no commissions to check'
      )
      if (empty) return empty
      // numeric(15,2) is exact — no rounding fudge factor needed.
      const r = await client.query(`
        SELECT count(*)::int AS n FROM specialist_commissions
        WHERE payable_amount > commission_amount
      `)
      return r.rows[0].n === 0
    },
  },
  {
    label: 'AP control 2100 GL == sum(specialist_balances.accrued + payable)',
    fn: async (client) => {
      const r = await client.query(`
        WITH gl AS (
          SELECT COALESCE(SUM(jl.credit - jl.debit), 0)::numeric(15, 2) AS bal
          FROM journal_lines jl
          JOIN accounts a ON a.id = jl.account_id
          WHERE a.code = '2100'
        ),
        sub AS (
          SELECT COALESCE(SUM(accrued_amount + payable_amount), 0)::numeric(15, 2) AS bal
          FROM specialist_balances
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
