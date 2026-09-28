/**
 * Re-exports shared utilities from @denel/utils so migrated portal features
 * that import from `@/lib/utils` keep working unchanged.
 */
export {
  cn,
  formatAmount,
  formatCompactNumber,
  formatCurrency,
  formatCurrencyCompact,
  formatDate,
  formatDateTime,
  parseCurrency,
} from '@denel/utils'
