/**
 * coa-seeder.ts
 *
 * Idempotent Chart-of-Accounts seeder. Migration 0032 inserts the default CoA
 * once, but this seeder lets a developer re-run on a fresh dev DB without
 * re-running migrations and lets new accounts be added in code reviews.
 *
 * Called at boot via `seedDefaultCoaIfEmpty`. Skips silently if any accounts
 * already exist — this is the safe default; admins manage CoA changes through
 * the UI after the initial seed.
 */

import { sql } from 'drizzle-orm'
import type { DB } from '../db'
import { accounts } from '../db/schema'

type SeedRow = {
  code: string
  name: string
  type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense'
  subtype: string | null
  isControl: boolean
  controlPartyType: 'patient' | 'supplier' | 'specialist' | 'insurance' | null
  normalBalance: 'debit' | 'credit'
}

export const DEFAULT_CHART_OF_ACCOUNTS: SeedRow[] = [
  // Assets
  {
    code: '1000',
    name: 'Cash on Hand',
    type: 'asset',
    subtype: 'Current',
    isControl: false,
    controlPartyType: null,
    normalBalance: 'debit',
  },
  {
    code: '1010',
    name: 'Bank Account — Main',
    type: 'asset',
    subtype: 'Current',
    isControl: false,
    controlPartyType: null,
    normalBalance: 'debit',
  },
  {
    code: '1020',
    name: 'Mobile Money — MTN',
    type: 'asset',
    subtype: 'Current',
    isControl: false,
    controlPartyType: null,
    normalBalance: 'debit',
  },
  {
    code: '1021',
    name: 'Mobile Money — Vodafone',
    type: 'asset',
    subtype: 'Current',
    isControl: false,
    controlPartyType: null,
    normalBalance: 'debit',
  },
  {
    code: '1030',
    name: 'Card Processor Receivable',
    type: 'asset',
    subtype: 'Current',
    isControl: false,
    controlPartyType: null,
    normalBalance: 'debit',
  },
  {
    code: '1200',
    name: 'Accounts Receivable — Patients',
    type: 'asset',
    subtype: 'Current',
    isControl: true,
    controlPartyType: 'patient',
    normalBalance: 'debit',
  },
  {
    code: '1210',
    name: 'Accounts Receivable — Insurance',
    type: 'asset',
    subtype: 'Current',
    isControl: true,
    controlPartyType: 'insurance',
    normalBalance: 'debit',
  },
  {
    code: '1500',
    name: 'Equipment',
    type: 'asset',
    subtype: 'Fixed',
    isControl: false,
    controlPartyType: null,
    normalBalance: 'debit',
  },
  {
    code: '1510',
    name: 'Accumulated Depreciation',
    type: 'asset',
    subtype: 'Contra-Fixed',
    isControl: false,
    controlPartyType: null,
    normalBalance: 'credit',
  },

  // Liabilities
  {
    code: '2000',
    name: 'Accounts Payable — Suppliers',
    type: 'liability',
    subtype: 'Current',
    isControl: true,
    controlPartyType: 'supplier',
    normalBalance: 'credit',
  },
  {
    code: '2100',
    name: 'Commission Payable — Specialists',
    type: 'liability',
    subtype: 'Current',
    isControl: true,
    controlPartyType: 'specialist',
    normalBalance: 'credit',
  },
  {
    code: '2200',
    name: 'Patient Deposits (Unapplied)',
    type: 'liability',
    subtype: 'Current',
    isControl: true,
    controlPartyType: 'patient',
    normalBalance: 'credit',
  },
  {
    code: '2300',
    name: 'VAT Payable',
    type: 'liability',
    subtype: 'Current',
    isControl: false,
    controlPartyType: null,
    normalBalance: 'credit',
  },
  {
    code: '2310',
    name: 'NHIL/GETFund Payable',
    type: 'liability',
    subtype: 'Current',
    isControl: false,
    controlPartyType: null,
    normalBalance: 'credit',
  },
  {
    code: '2320',
    name: 'Withholding Tax Payable',
    type: 'liability',
    subtype: 'Current',
    isControl: false,
    controlPartyType: null,
    normalBalance: 'credit',
  },

  // Equity
  {
    code: '3000',
    name: "Owner's Capital",
    type: 'equity',
    subtype: null,
    isControl: false,
    controlPartyType: null,
    normalBalance: 'credit',
  },
  {
    code: '3100',
    name: 'Retained Earnings',
    type: 'equity',
    subtype: null,
    isControl: false,
    controlPartyType: null,
    normalBalance: 'credit',
  },

  // Revenue
  {
    code: '4100',
    name: 'Revenue — Diagnostic',
    type: 'revenue',
    subtype: 'Operating',
    isControl: false,
    controlPartyType: null,
    normalBalance: 'credit',
  },
  {
    code: '4110',
    name: 'Revenue — Preventive',
    type: 'revenue',
    subtype: 'Operating',
    isControl: false,
    controlPartyType: null,
    normalBalance: 'credit',
  },
  {
    code: '4120',
    name: 'Revenue — Restorative',
    type: 'revenue',
    subtype: 'Operating',
    isControl: false,
    controlPartyType: null,
    normalBalance: 'credit',
  },
  {
    code: '4130',
    name: 'Revenue — Endodontics',
    type: 'revenue',
    subtype: 'Operating',
    isControl: false,
    controlPartyType: null,
    normalBalance: 'credit',
  },
  {
    code: '4140',
    name: 'Revenue — Periodontics',
    type: 'revenue',
    subtype: 'Operating',
    isControl: false,
    controlPartyType: null,
    normalBalance: 'credit',
  },
  {
    code: '4150',
    name: 'Revenue — Oral Surgery',
    type: 'revenue',
    subtype: 'Operating',
    isControl: false,
    controlPartyType: null,
    normalBalance: 'credit',
  },
  {
    code: '4160',
    name: 'Revenue — Orthodontics',
    type: 'revenue',
    subtype: 'Operating',
    isControl: false,
    controlPartyType: null,
    normalBalance: 'credit',
  },
  {
    code: '4170',
    name: 'Revenue — Prosthodontics',
    type: 'revenue',
    subtype: 'Operating',
    isControl: false,
    controlPartyType: null,
    normalBalance: 'credit',
  },
  {
    code: '4180',
    name: 'Revenue — Cosmetic',
    type: 'revenue',
    subtype: 'Operating',
    isControl: false,
    controlPartyType: null,
    normalBalance: 'credit',
  },
  {
    code: '4810',
    name: 'Gain on Asset Disposal',
    type: 'revenue',
    subtype: 'Other',
    isControl: false,
    controlPartyType: null,
    normalBalance: 'credit',
  },
  {
    code: '4900',
    name: 'Discounts Given (Contra-Revenue)',
    type: 'revenue',
    subtype: 'Contra',
    isControl: false,
    controlPartyType: null,
    normalBalance: 'debit',
  },

  // Expenses
  {
    code: '5100',
    name: 'Salaries Expense',
    type: 'expense',
    subtype: 'Operating',
    isControl: false,
    controlPartyType: null,
    normalBalance: 'debit',
  },
  {
    code: '5110',
    name: 'Specialist Commission Expense',
    type: 'expense',
    subtype: 'Operating',
    isControl: false,
    controlPartyType: null,
    normalBalance: 'debit',
  },
  {
    code: '5200',
    name: 'Dental Supplies',
    type: 'expense',
    subtype: 'Operating',
    isControl: false,
    controlPartyType: null,
    normalBalance: 'debit',
  },
  {
    code: '5210',
    name: 'Lab Fees',
    type: 'expense',
    subtype: 'Operating',
    isControl: false,
    controlPartyType: null,
    normalBalance: 'debit',
  },
  {
    code: '5300',
    name: 'Rent Expense',
    type: 'expense',
    subtype: 'Operating',
    isControl: false,
    controlPartyType: null,
    normalBalance: 'debit',
  },
  {
    code: '5310',
    name: 'Utilities Expense',
    type: 'expense',
    subtype: 'Operating',
    isControl: false,
    controlPartyType: null,
    normalBalance: 'debit',
  },
  {
    code: '5400',
    name: 'Marketing Expense',
    type: 'expense',
    subtype: 'Operating',
    isControl: false,
    controlPartyType: null,
    normalBalance: 'debit',
  },
  {
    code: '5500',
    name: 'Depreciation Expense',
    type: 'expense',
    subtype: 'Operating',
    isControl: false,
    controlPartyType: null,
    normalBalance: 'debit',
  },
  {
    code: '5610',
    name: 'WHT Expense',
    type: 'expense',
    subtype: 'Operating',
    isControl: false,
    controlPartyType: null,
    normalBalance: 'debit',
  },
  {
    code: '5620',
    name: 'CIT Expense',
    type: 'expense',
    subtype: 'Operating',
    isControl: false,
    controlPartyType: null,
    normalBalance: 'debit',
  },
  {
    code: '5810',
    name: 'Loss on Asset Disposal',
    type: 'expense',
    subtype: 'Other',
    isControl: false,
    controlPartyType: null,
    normalBalance: 'debit',
  },
  {
    code: '5900',
    name: 'Bad Debt Expense',
    type: 'expense',
    subtype: 'Operating',
    isControl: false,
    controlPartyType: null,
    normalBalance: 'debit',
  },
]

/**
 * Insert any missing default accounts. Existing rows are left alone — admins
 * may have customised the names / subtypes / control settings.
 */
export async function seedDefaultCoa(db: DB): Promise<{ inserted: number; total: number }> {
  let inserted = 0
  for (const row of DEFAULT_CHART_OF_ACCOUNTS) {
    const result = await db
      .insert(accounts)
      .values(row)
      .onConflictDoNothing({ target: accounts.code })
      .returning({ id: accounts.id })
    if (result.length > 0) inserted++
  }
  return { inserted, total: DEFAULT_CHART_OF_ACCOUNTS.length }
}

/**
 * Lazy seeder for boot — runs only on a completely empty `accounts` table.
 * Migration 0032 covers the production seed; this is a dev-loop convenience.
 */
export async function seedDefaultCoaIfEmpty(db: DB): Promise<void> {
  const rows = await db.execute(sql`SELECT count(*)::int AS count FROM accounts`)
  const count =
    (rows as unknown as { rows?: { count: number }[] }).rows?.[0]?.count ??
    (Array.isArray(rows) ? (rows as unknown as { count: number }[])[0]?.count : undefined)
  if (count && count > 0) return
  await seedDefaultCoa(db)
}
