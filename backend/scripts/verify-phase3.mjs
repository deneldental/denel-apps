// verify-phase3.mjs — assert Phase 3 invariants.
//   * payment_allocations table exists
//   * Every posted payment with invoiceId has at least one allocation row
//   * Every payment has new columns populated (payment_number, channel_account_id, party_*)
//   * Status enum migrated (no 'completed'/'refunded'/'pending'/'failed' rows)
//   * SUM(payment_allocations.amount) per payment <= payments.amount
//   * No unbalanced journal entries
// Row-dependent checks SKIP when the relevant table is empty.

import { skipIfEmpty, verify } from './_verify-lib.mjs'

await verify([
  {
    label: 'payment_allocations table exists',
    fn: async (client) => {
      const r = await client.query(
        `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='payment_allocations'`
      )
      return r.rowCount === 1
    },
  },
  {
    label: 'every posted payment with invoiceId has an allocation',
    fn: async (client) => {
      const empty = await skipIfEmpty(client, 'payments', 'no payments to check')
      if (empty) return empty
      const r = await client.query(`
        SELECT count(*)::int AS n FROM payments p
        WHERE p.status = 'posted'
          AND p."invoiceId" IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM payment_allocations a WHERE a.payment_id = p.id)
      `)
      if (r.rows[0].n > 0) console.log('   missing allocation for', r.rows[0].n, 'payments')
      return r.rows[0].n === 0
    },
  },
  {
    label: 'every payment has payment_number, channel_account_id, party_id',
    fn: async (client) => {
      const empty = await skipIfEmpty(client, 'payments', 'no payments to check')
      if (empty) return empty
      const r = await client.query(`
        SELECT count(*)::int AS n FROM payments
        WHERE payment_number IS NULL
           OR channel_account_id IS NULL
           OR party_id IS NULL
      `)
      if (r.rows[0].n > 0) console.log('   incomplete columns on', r.rows[0].n, 'payments')
      return r.rows[0].n === 0
    },
  },
  {
    label: 'legacy payment statuses migrated',
    fn: async (client) => {
      const empty = await skipIfEmpty(client, 'payments', 'no payments to check')
      if (empty) return empty
      const r = await client.query(`
        SELECT count(*)::int AS n FROM payments
        WHERE status IN ('completed','refunded','pending','failed')
      `)
      return r.rows[0].n === 0
    },
  },
  {
    label: 'allocations never exceed payment amount',
    fn: async (client) => {
      const empty = await skipIfEmpty(client, 'payment_allocations', 'no allocations to check')
      if (empty) return empty
      const r = await client.query(`
        SELECT p.id, p.amount, COALESCE(SUM(a.amount), 0) AS alloc_sum
        FROM payments p
        LEFT JOIN payment_allocations a ON a.payment_id = p.id
        GROUP BY p.id, p.amount
        HAVING COALESCE(SUM(a.amount), 0) > p.amount + 0.005
      `)
      if (r.rows.length > 0) {
        for (const row of r.rows)
          console.log('   over-allocated:', row.id, row.alloc_sum, '>', row.amount)
      }
      return r.rowCount === 0
    },
  },
  {
    label: 'payment_numbers unique per year-prefix',
    fn: async (client) => {
      const empty = await skipIfEmpty(client, 'payments', 'no payments to check')
      if (empty) return empty
      const r = await client.query(`
        SELECT payment_number, count(*)::int AS n
        FROM payments
        WHERE payment_number IS NOT NULL
        GROUP BY payment_number
        HAVING count(*) > 1
      `)
      return r.rowCount === 0
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
    label: 'payment sequence registered',
    fn: async (client) => {
      const r = await client.query(`
        SELECT next_number FROM number_sequences WHERE sequence_key = 'payment'
      `)
      return r.rowCount === 1 && r.rows[0].next_number >= 1
    },
  },
])
