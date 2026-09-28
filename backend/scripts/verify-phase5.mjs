// verify-phase5.mjs — assert Phase 5 invariants.
//   * payment_plan_schedule_items table exists
//   * Every plan has invoice_id, plan_number, schedule_type
//   * Every fixed plan has schedule items summing to plan.totalAmount
//   * Every plan has a master invoice with type plan_total
//   * Archived child invoices have zero balance and status void
//   * patient_balances.ar_balance matches sum of open non-archived invoices
//   * No allocations point at archived child invoices
// Row-dependent checks SKIP when the relevant table is empty.

import { skipIfEmpty, verify } from './_verify-lib.mjs'

await verify([
  {
    label: 'payment_plan_schedule_items table exists',
    fn: async (client) => {
      const r = await client.query(
        `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='payment_plan_schedule_items'`
      )
      return r.rowCount === 1
    },
  },
  {
    label: 'every plan has plan_number + invoice_id + schedule_type',
    fn: async (client) => {
      const empty = await skipIfEmpty(client, 'payment_plans', 'no payment plans to check')
      if (empty) return empty
      const r = await client.query(`
        SELECT count(*)::int AS n FROM payment_plans
        WHERE plan_number IS NULL OR invoice_id IS NULL OR schedule_type IS NULL
      `)
      if (r.rows[0].n > 0) console.log('   incomplete:', r.rows[0].n)
      return r.rows[0].n === 0
    },
  },
  {
    label: 'every fixed plan has schedule_items summing to totalAmount',
    fn: async (client) => {
      const empty = await skipIfEmpty(client, 'payment_plans', 'no payment plans to check')
      if (empty) return empty
      const r = await client.query(`
        SELECT pp.id, pp."totalAmount" AS plan_total,
               COALESCE(SUM(si.expected_amount), 0) AS schedule_total
        FROM payment_plans pp
        LEFT JOIN payment_plan_schedule_items si ON si.payment_plan_id = pp.id
        WHERE pp.schedule_type = 'fixed'
        GROUP BY pp.id, pp."totalAmount"
        HAVING ABS(pp."totalAmount" - COALESCE(SUM(si.expected_amount), 0)) > 0.01
      `)
      if (r.rows.length > 0) {
        for (const row of r.rows)
          console.log('   mismatch:', row.id, row.plan_total, '!=', row.schedule_total)
      }
      return r.rowCount === 0
    },
  },
  {
    label: 'every plan has a master invoice with type plan_total',
    fn: async (client) => {
      const empty = await skipIfEmpty(client, 'payment_plans', 'no payment plans to check')
      if (empty) return empty
      const r = await client.query(`
        SELECT count(*)::int AS n FROM payment_plans pp
        WHERE NOT EXISTS (
          SELECT 1 FROM invoices i WHERE i.id = pp.invoice_id AND i.type = 'plan_total'
        )
      `)
      return r.rows[0].n === 0
    },
  },
  {
    label: 'archived child invoices have zero balance and status void',
    fn: async (client) => {
      const r = await client.query(`
        SELECT count(*)::int AS n FROM invoices
        WHERE archived = true AND (balance <> 0 OR status <> 'void')
      `)
      return r.rows[0].n === 0
    },
  },
  {
    label: 'patient_balances.ar_balance matches sum of open non-archived invoices',
    fn: async (client) => {
      const empty = await skipIfEmpty(client, 'patient_balances', 'no patient balances to check')
      if (empty) return empty
      const r = await client.query(`
        WITH derived AS (
          SELECT "patientId" AS pid, COALESCE(SUM(balance), 0)::numeric(15, 2) AS bal
          FROM invoices
          WHERE archived = false AND status IN ('issued', 'partially_paid')
          GROUP BY "patientId"
        )
        SELECT pb.patient_id, pb.ar_balance, COALESCE(d.bal, 0) AS derived_bal
        FROM patient_balances pb
        LEFT JOIN derived d ON d.pid = pb.patient_id
        WHERE ABS(pb.ar_balance - COALESCE(d.bal, 0)) > 0.01
      `)
      if (r.rows.length > 0) {
        for (const row of r.rows)
          console.log('   drift:', row.patient_id, row.ar_balance, '!=', row.derived_bal)
      }
      return r.rowCount === 0
    },
  },
  {
    label: 'no allocations point at archived child invoices',
    fn: async (client) => {
      const empty = await skipIfEmpty(client, 'payment_allocations', 'no allocations to check')
      if (empty) return empty
      const r = await client.query(`
        SELECT count(*)::int AS n
        FROM payment_allocations pa
        JOIN invoices i ON i.id = pa.target_id
        WHERE pa.target_type = 'invoice' AND i.archived = true
      `)
      return r.rows[0].n === 0
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
