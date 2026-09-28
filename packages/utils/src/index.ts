// @denel/utils — small, dependency-light helpers reused across backend and
// frontend apps. Pure functions only; no I/O.

export { type Cents, cedisToCents, cents, toCents, ZERO_CENTS } from './cents'
export { cn } from './cn'
export {
  atClockTime,
  type CrmAutomationPolicies,
  DEFAULT_CRM_POLICIES,
  isClockTime,
  isWithinQuietHours,
  normalizeCrmPolicies,
  normalizeSmsTags,
  parseClockTime,
} from './crm-policies'
export {
  centsToInput,
  formatAmount,
  formatCompactNumber,
  formatCurrency,
  formatCurrencyCompact,
  formatPercent,
  inputToCents,
  parseCurrency,
} from './currency'
export { formatDate, formatDateTime } from './date'
export { Money, type MoneyLike, type RoundingMode } from './money'
export {
  cedisToPesewas,
  computePettyBalance,
  DEFAULT_PETTY_CASH_POLICY,
  decidePettyReview,
  iouCapReached,
  normalizePettyCashPolicy,
  type PettyBalanceInput,
  type PettyCashPolicy,
  type PettyReviewDecision,
} from './petty-cash-policy'
export { type LookupSlugOptions, toLookupSlug } from './slug'
export {
  computeGhanaTax,
  GRA_TAX_RATES,
  reverseGhanaTax,
  type TaxBreakdown,
  type TaxOptions,
} from './tax'
export {
  computeGhanaOvertimeTax,
  computeGhanaPAYE,
  computeGhanaPAYEBands,
  computeGhanaPayrollFromParts,
  computeGhanaPayslip,
  computeSSNIT,
  GHANA_PAYE_2024,
  type OvertimeTaxCategory,
  type PAYEBand,
  type PayrollComputation,
  type PayslipBreakdown,
  QJE_MONTHLY_BASIC_CEILING,
  SSNIT_EMPLOYEE_RATE_2024,
  SSNIT_EMPLOYER_RATE_2024,
  type SSNITBreakdown,
  type TaxBracket,
} from './tax-payroll'
export {
  fdiToPalmer,
  fdiToUniversal,
  formatTeeth,
  formatTooth,
  isPermanentFdi,
  isToothNotation,
  TOOTH_NOTATION_LABELS,
  TOOTH_NOTATIONS,
  type ToothNotation,
} from './tooth-notation'
