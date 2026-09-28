// verify-phase4.mjs — assert Phase 4 invariants.
//   * credit_notes / credit_note_lines tables exist
//   * credit_notes permissions seeded
//   * credit_note sequence registered
//   * reason CHECK constraint accepts the spec's reasons
//   * No unbalanced journal entries (SKIPs when there are none yet)

import { skipIfEmpty, verify } from './_verify-lib.mjs'

await verify([
  {
    label: 'credit_notes table exists',
    fn: async (client) => {
      const r = await client.query(
        `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='credit_notes'`
      )
      return r.rowCount === 1
    },
  },
  {
    label: 'credit_note_lines table exists',
    fn: async (client) => {
      const r = await client.query(
        `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='credit_note_lines'`
      )
      return r.rowCount === 1
    },
  },
  {
    label: 'credit_notes permissions seeded',
    fn: async (client) => {
      const r = await client.query(
        `SELECT count(*)::int AS n FROM permissions WHERE module = 'credit_notes'`
      )
      return r.rows[0].n === 4
    },
  },
  {
    label: 'credit_note number sequence registered',
    fn: async (client) => {
      const r = await client.query(
        `SELECT 1 FROM number_sequences WHERE sequence_key = 'credit_note'`
      )
      return r.rowCount === 1
    },
  },
  {
    label: 'reason check constraint accepts spec values',
    fn: async (client) => {
      const r = await client.query(`
        SELECT pg_get_constraintdef(c.oid) AS def
        FROM pg_constraint c
        JOIN pg_class t ON c.conrelid = t.oid
        WHERE t.relname = 'credit_notes' AND c.conname = 'credit_notes_reason_check'
      `)
      if (r.rows.length === 0) return false
      const def = r.rows[0].def
      return (
        def.includes("'discount'") &&
        def.includes("'correction'") &&
        def.includes("'cancellation'") &&
        def.includes("'goodwill'") &&
        def.includes("'write_off'")
      )
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
