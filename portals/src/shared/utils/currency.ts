/**
 * GHS currency helpers.
 *
 * These used to be a second, portal-local implementation that duplicated
 * `@denel/utils` under the same export names but with the opposite unit
 * contract (cents here, cedis there). The shared module is now the single
 * cents-based implementation; this file stays as a re-export so the ~42
 * `@/shared/utils/currency` imports across the portal keep resolving.
 *
 * All money arguments are integer CENTS. See `packages/utils/src/currency.ts`.
 */
export {
  type Cents,
  cedisToCents,
  cents,
  centsToInput,
  formatAmount,
  formatCompactNumber,
  formatCurrency,
  formatCurrencyCompact,
  formatPercent,
  inputToCents,
  parseCurrency,
  toCents,
  ZERO_CENTS,
} from '@denel/utils'

import { formatCurrencyCompact } from '@denel/utils'

/** Alias for `formatCurrencyCompact`, kept for existing imports. */
export const formatCompactCurrency = formatCurrencyCompact
