/**
 * settings-domain-audit A5 / D2 / E against a real Postgres: an export never
 * carries integration secrets, does carry the Settings-managed lookup tables,
 * and an import refuses integration keys instead of overwriting live tokens.
 * Inside withRollback.
 */
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { categories, clinicHolidays, clinicSettings, patientTags } from '../../src/db/schema'
import { exportSettings, importSettings } from '../../src/lib/settings-export'
import { anyUserId } from './_fixtures'
import { noDb, withRollback } from './_setup'

describe.skipIf(noDb)('settings export ↔ import (S6)', () => {
  it('excludes integration secrets, keeps branding, carries the new lookup tables', async () => {
    await withRollback(async (tx) => {
      const tag = randomUUID().slice(0, 8)
      await tx
        .insert(clinicSettings)
        .values([
          { key: 'integrations:google_oauth_config', value: { clientId: 'x' } },
          { key: `integrations:google_contacts_token:user-${tag}`, value: { token: 'secret' } },
          { key: 'integration_r2', value: { accessKey: 'secret' } },
          { key: 'module_visibility', value: { insurance: false } },
        ])
        .onConflictDoNothing()
      await tx.insert(categories).values({ name: `it_cat_${tag}` })
      await tx.insert(patientTags).values({ name: `it_tag_${tag}` })
      await tx.insert(clinicHolidays).values({ date: '2099-12-31', name: `IT holiday ${tag}` })

      const out = await exportSettings(tx)
      const keys = (out.clinicSettings as Array<{ key: string }>).map((r) => r.key)
      expect(keys).toContain('module_visibility')
      expect(keys.filter((k) => k.startsWith('integrations:'))).toEqual([])
      expect(
        keys.filter((k) => k.startsWith('integration_') && k !== 'integration_branding')
      ).toEqual([])
      expect(
        (out.categories as Array<{ name: string }>).some((r) => r.name === `it_cat_${tag}`)
      ).toBe(true)
      expect(
        (out.patientTags as Array<{ name: string }>).some((r) => r.name === `it_tag_${tag}`)
      ).toBe(true)
      expect(
        (out.clinicHolidays as Array<{ name: string }>).some((r) => r.name === `IT holiday ${tag}`)
      ).toBe(true)
    })
  })

  it('import refuses integration keys and reports them, importing the rest', async () => {
    await withRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const tag = randomUUID().slice(0, 8)
      const result = await importSettings(
        tx,
        {
          clinicSettings: [
            { key: 'integrations:google_oauth_config', value: { clientId: 'from-elsewhere' } },
            { key: `it_setting_${tag}`, value: { ok: true } },
          ],
        },
        userId
      )
      expect(result.imported).toBe(1)
      expect(result.failures).toEqual([
        expect.objectContaining({
          table: 'clinicSettings',
          row: 'integrations:google_oauth_config',
        }),
      ])
      const [row] = await tx
        .select({ key: clinicSettings.key })
        .from(clinicSettings)
        .where(eq(clinicSettings.key, 'integrations:google_oauth_config'))
      expect(row).toBeUndefined()
    })
  })
})
