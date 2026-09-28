/**
 * Settings import against a REAL Postgres (settings-domain-audit B2).
 *
 * Two things a fake DB cannot prove:
 *
 *   • `clinic_settings.updatedById` is an FK to `user.id`. An export made on
 *     another instance (or before a user was deleted) carries ids this DB does
 *     not have, and the old import wrote them verbatim — one such row aborted
 *     the whole transaction with a 500. The importer is the one writing, so
 *     the importer's id is what the row must carry.
 *
 *   • Catching a failed statement INSIDE a Postgres transaction does not
 *     un-fail the transaction: every later statement answers 25P02 and the
 *     COMMIT becomes a ROLLBACK. The old lookup loop caught per row and
 *     reported "imported: N" for rows Postgres then threw away. Each row must
 *     run in its own savepoint so one bad row costs exactly that row.
 *
 * Run with `node scripts/dev-local.mjs npx vitest run tests/integration/settings-import.test.ts`
 * (gated on DATABASE_URL). Everything happens inside `withRollback`.
 */
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { clinicSettings, units } from '../../src/db/schema'
import { importSettings } from '../../src/lib/settings-export'
import { anyUserId } from './_fixtures'
import { noDb, withRollback } from './_setup'

const PREFIX = '__it_import_'

describe.skipIf(noDb)('importSettings', () => {
  it('imports a clinic setting whose updatedById is unknown here, stamped with the importer', async () => {
    await withRollback(async (tx) => {
      const importer = await anyUserId(tx)
      const key = `${PREFIX}${randomUUID()}`

      const result = await importSettings(
        tx,
        {
          clinicSettings: [
            {
              key,
              value: { enabled: true },
              updatedById: 'user-from-another-environment',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
          ],
        },
        importer
      )

      expect(result.failures).toEqual([])
      expect(result.imported).toBe(1)

      const [row] = await tx.select().from(clinicSettings).where(eq(clinicSettings.key, key))
      expect(row?.value).toEqual({ enabled: true })
      expect(row?.updatedById).toBe(importer)
    })
  })

  it('reports a clinic-settings row without a key or value and still imports the rest', async () => {
    await withRollback(async (tx) => {
      const importer = await anyUserId(tx)
      const good = `${PREFIX}${randomUUID()}`

      const result = await importSettings(
        tx,
        { clinicSettings: [{ value: 1 }, { key: good, value: 'kept' }] },
        importer
      )

      expect(result.failures).toHaveLength(1)
      expect(result.failures[0]?.table).toBe('clinicSettings')
      expect(result.imported).toBe(1)
      const [row] = await tx.select().from(clinicSettings).where(eq(clinicSettings.key, good))
      expect(row?.value).toBe('kept')
    })
  })

  it('a lookup row that violates a constraint is reported and the rows after it still import', async () => {
    await withRollback(async (tx) => {
      const importer = await anyUserId(tx)
      const dupName = `${PREFIX}dup_${randomUUID().slice(0, 8)}`
      const okName = `${PREFIX}ok_${randomUUID().slice(0, 8)}`
      // An existing unit with this name; the import row below has a different
      // id, so the upsert (keyed on id) hits unique(name) instead.
      await tx.insert(units).values({ name: dupName, displayName: 'existing' })

      const result = await importSettings(
        tx,
        {
          units: [
            { id: randomUUID(), name: dupName, displayName: 'clashes' },
            { id: randomUUID(), name: okName, displayName: 'fine' },
          ],
        },
        importer
      )

      expect(result.failures).toHaveLength(1)
      expect(result.failures[0]?.table).toBe('units')
      expect(result.imported).toBe(1)

      const okRows = await tx.select().from(units).where(eq(units.name, okName))
      expect(okRows).toHaveLength(1)
      expect(okRows[0]?.displayName).toBe('fine')
    })
  })
})
