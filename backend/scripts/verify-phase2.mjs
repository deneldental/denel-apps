// verify-phase2.mjs — assert Phase 2 invariants.
//   * invoice_lines / specialists / patient_balances tables exist
//   * Every existing invoice has at least one line (JSONB backfill ran)
//   * patient_balances populated for every patient with a wallet or invoice
//   * specialists permissions seeded
//   * No unbalanced journal entries (SKIPs when there are none yet)

import { skipIfEmpty, verify } from './_verify-lib.mjs'

await verify([
  {
    label: 'invoice_lines table exists',
    fn: async (client) => {
      const r = await client.query(
        `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='invoice_lines'`
      )
      return r.rowCount === 1
    },
  },
  {
    label: 'specialists table exists',
    fn: async (client) => {
      const r = await client.query(
        `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='specialists'`
      )
      return r.rowCount === 1
    },
  },
  {
    label: 'patient_balances table exists',
    fn: async (client) => {
      const r = await client.query(
        `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='patient_balances'`
      )
      return r.rowCount === 1
    },
  },
  {
    label: 'every invoice has at least one line',
    fn: async (client) => {
      const empty = await skipIfEmpty(client, 'invoices', 'no invoices to check')
      if (empty) return empty
      const r = await client.query(`
        SELECT count(*)::int AS n FROM invoices i
        WHERE NOT EXISTS (SELECT 1 FROM invoice_lines il WHERE il.invoice_id = i.id)
      `)
      if (r.rows[0].n > 0) console.log('   missing lines for', r.rows[0].n, 'invoices')
      return r.rows[0].n === 0
    },
  },
  {
    label: 'legacy invoice statuses migrated',
    fn: async (client) => {
      const empty = await skipIfEmpty(client, 'invoices', 'no invoices to check')
      if (empty) return empty
      const r = await client.query(`
        SELECT count(*)::int AS n FROM invoices
        WHERE status IN ('pending','partial','waived','overdue')
      `)
      return r.rows[0].n === 0
    },
  },
  {
    label: 'patient_balances populated for every patient with wallet or invoice',
    fn: async (client) => {
      const wantR = await client.query(`
        SELECT count(DISTINCT id)::int AS n FROM (
          SELECT p.id FROM patients p
          WHERE EXISTS (SELECT 1 FROM patient_wallets w WHERE w."patientId" = p.id)
             OR EXISTS (SELECT 1 FROM invoices i WHERE i."patientId" = p.id)
        ) sub
      `)
      if (wantR.rows[0].n === 0) {
        return { skip: true, reason: 'no patients with wallets or invoices' }
      }
      const gotR = await client.query('SELECT count(*)::int AS n FROM patient_balances')
      if (gotR.rows[0].n < wantR.rows[0].n) {
        console.log('   want >=', wantR.rows[0].n, 'got', gotR.rows[0].n)
      }
      return gotR.rows[0].n >= wantR.rows[0].n
    },
  },
  {
    label: 'new specialists permissions seeded',
    fn: async (client) => {
      const r = await client.query(
        `SELECT count(*)::int AS n FROM permissions WHERE module = 'specialists'`
      )
      return r.rows[0].n === 4
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
