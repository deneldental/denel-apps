/**
 * finance-accounts.ts — the single source of truth for GL account *codes*.
 *
 * Every posting service used to declare its own `const AR_CODE = '1200'` (and
 * `AR_ACCOUNT_CODE`, `TAX_CODE` vs `TAX_ACCOUNT_CODE`, …) — a typo or a CoA
 * renumber meant hunting through ~6 files. Import the code from here instead;
 * resolve it to an account row with `getAccountByCode`.
 *
 * Codes match the seeded Chart of Accounts (migration 0032).
 */
export const FINANCE_ACCOUNTS = {
  CASH: '1000', // Cash on Hand
  BANK: '1010', // Bank Account — Main
  AR: '1200', // Accounts Receivable — Patients
  AR_INSURANCE: '1210', // Accounts Receivable — Insurance
  AR_SPECIALISTS: '1220', // Accounts Receivable — Specialists (Phase 3: external lab cases billed to referring doctors)
  STAFF_LOAN_RECEIVABLE: '1230', // Staff Loan Receivable (payroll loan deductions settle this asset; migration 0144)
  AP: '2000', // Accounts Payable — Suppliers
  COMMISSION_PAYABLE: '2100', // Commission Payable — Specialists
  PATIENT_DEPOSITS: '2200', // Patient Deposits (unapplied patient credit)
  TAX_PAYABLE: '2300', // VAT / tax payable
  NHIL_GETFUND_PAYABLE: '2310', // NHIL/GETFund Payable
  WHT_PAYABLE: '2320', // Withholding tax payable
  DEFERRED_REVENUE: '2400', // Deferred Revenue
  XRAY_REVENUE: '4100', // Revenue — Diagnostic (imaging maps here; see xray-charge-service)
  LAB_REVENUE: '4170', // Revenue — Prosthodontics (dental-lab work maps here; see lab-case-billing)
  GAIN_ON_DISPOSAL: '4810', // Gain on Asset Disposal
  DISCOUNTS_GIVEN: '4900', // Discounts Given (contra-revenue)
  SALARIES_EXPENSE: '5100', // Salaries Expense
  COMMISSION_EXPENSE: '5110', // Specialist Commission Expense
  BAD_DEBT_EXPENSE: '5900', // Bad Debt Expense
  LOSS_ON_DISPOSAL: '5810', // Loss on Asset Disposal
  // — admin-v1 Phase 4 (migration 0105) —
  INVENTORY: '1400', // Inventory asset (retail stock valuation)
  RETAIL_REVENUE: '4200', // Retail Sales Revenue
  COGS: '5000', // Cost of Goods Sold
  PAYE_PAYABLE: '2330', // PAYE (employee income tax) payable
  SSNIT_PAYABLE: '2340', // SSNIT (pension) payable — employee + employer
  NET_SALARIES_PAYABLE: '2350', // Net salaries payable (publish accrues here; disbursement clears it; migration 0147)
  SSNIT_EMPLOYER_EXPENSE: '5120', // SSNIT employer contribution expense
  // — admin-v1 §4.4 (migration 0138) —
  WHT_EXPENSE: '5610', // Withholding tax expense
  CIT_EXPENSE: '5620', // Corporate income tax expense
} as const

export type FinanceAccountCode = (typeof FINANCE_ACCOUNTS)[keyof typeof FINANCE_ACCOUNTS]
