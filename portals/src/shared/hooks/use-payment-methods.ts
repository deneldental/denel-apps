import { useLookup } from '@/shared/hooks/use-lookup'

/**
 * A single row of the configurable payment-method lookup
 * (`GET /api/lookups/payment-methods`). `name` is a snake_case slug
 * (`cash`, `mobile_money`, `bank_transfer`, `hubtel_pos`, …) and is the
 * value submitted to the backend as the payment `method` string.
 */
export type PaymentMethodLookup = {
  id: string
  name: string
  displayName: string | null
  isActive: boolean
}

type UsePaymentMethodsReturn = {
  methods: PaymentMethodLookup[]
  isLoading: boolean
  error: string | null
}

/**
 * Fetches the clinic's configured payment methods and returns them in a stable
 * shape. Screens that need a payment-method dropdown should render
 * <PaymentMethodSelect> (which drives itself off this hook) rather than
 * hardcoding a local array — that way "Settings → Finance & Billing → Payment
 * Methods" is the single source of truth everywhere.
 *
 * Thin wrapper over the generic `useLookup('payment-methods')` so it shares the
 * same cache entry and refresh behaviour as every other lookup: the Settings
 * section invalidates `queryKeys.settings.lookup('payment-methods')` on save, so
 * adding/renaming a method refreshes every open <PaymentMethodSelect> without a
 * reload.
 */
export function usePaymentMethods(): UsePaymentMethodsReturn {
  const { rows, isLoading, error } = useLookup('payment-methods')
  return { methods: rows, isLoading, error }
}
