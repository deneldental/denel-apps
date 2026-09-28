/**
 * GHS currency helpers. Re-exported from `@denel/utils` so migrated portal
 * features that import from `@/shared/utils/currency` keep working unchanged.
 *
 * All money arguments are integer CENTS — see `packages/utils/src/currency.ts`.
 */
export {
  formatAmount,
  formatCompactNumber,
  formatCurrency,
  formatCurrencyCompact,
  formatPercent,
  parseCurrency,
} from '@denel/utils'
