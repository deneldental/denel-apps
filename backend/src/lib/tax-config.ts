/**
 * tax-config.ts — D6: Ghana VAT/NHIL/GETFund rates are *configuration*, not
 * hard-coded constants.
 *
 * The authoritative rates live in the `tax_rates` row of `clinic_settings`;
 * `computeGhanaTax` takes them as a parameter. This helper reads that row,
 * falling back to the GRA standard rates only if the settings row is somehow
 * missing or malformed.
 */
import { GRA_TAX_RATES } from '@denel/utils'
import { eq } from 'drizzle-orm'
import type { DB } from '../db'
import { clinicSettings } from '../db/schema'

export type TaxRates = { vat: number; nhil: number; getfund: number }

const DEFAULT_RATES: TaxRates = {
  vat: GRA_TAX_RATES.VAT,
  nhil: GRA_TAX_RATES.NHIL,
  getfund: GRA_TAX_RATES.GETFUND,
}

/** Resolve the active Ghana tax rates from `clinic_settings.tax_rates`. */
export async function getTaxRates(db: DB): Promise<TaxRates> {
  const [row] = await db
    .select()
    .from(clinicSettings)
    .where(eq(clinicSettings.key, 'tax_rates'))
    .limit(1)
  const v = (row?.value ?? undefined) as Partial<TaxRates> | undefined
  if (!v) return DEFAULT_RATES
  return {
    vat: typeof v.vat === 'number' ? v.vat : DEFAULT_RATES.vat,
    nhil: typeof v.nhil === 'number' ? v.nhil : DEFAULT_RATES.nhil,
    getfund: typeof v.getfund === 'number' ? v.getfund : DEFAULT_RATES.getfund,
  }
}
