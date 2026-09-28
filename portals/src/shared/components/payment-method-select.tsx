import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select'
import { type PaymentMethodLookup, usePaymentMethods } from '@/shared/hooks/use-payment-methods'

export type { PaymentMethodLookup }

interface PaymentMethodSelectProps {
  value: string
  onValueChange: (value: string) => void
  disabled?: boolean
  /**
   * Lookup method `name`s to hide from this particular picker — e.g. a wallet
   * top-up can't be funded from the wallet itself, so it excludes `wallet`
   * even though that's an active, admin-configured method everywhere else.
   */
  excludeMethods?: string[]
  id?: string
  className?: string
  placeholder?: string
}

/**
 * Shared payment-method dropdown fed entirely by the configurable lookup
 * (`usePaymentMethods()` → "Settings → Finance & Billing → Payment Methods").
 * Presentational + hook-driven only — no submit logic, no default-selection.
 *
 * Items are exactly the active lookup rows (`value = name`, label =
 * `displayName || name`) — including "Wallet credit" and "Insurance" when an
 * admin has added those rows (seeded by migration 0213). There is
 * deliberately no synthetic fallback here: this used to append hardcoded
 * "Insurance" / "Wallet credit" items whenever the lookup had none, which
 * meant an admin could never rename or deactivate them. If a clinic removes
 * those rows, the corresponding payment option simply stops being offered —
 * same as removing any other method.
 *
 * While the lookup is loading, a disabled trigger shows the placeholder.
 */
export function PaymentMethodSelect({
  value,
  onValueChange,
  disabled,
  excludeMethods,
  id,
  className,
  placeholder = 'Select payment method',
}: PaymentMethodSelectProps) {
  const { methods, isLoading } = usePaymentMethods()

  if (isLoading) {
    return (
      <Select value="" disabled>
        <SelectTrigger id={id} className={className}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
      </Select>
    )
  }

  const active = methods.filter((m) => m.isActive && !excludeMethods?.includes(m.name))

  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger id={id} className={className}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {active.map((m) => (
          <SelectItem key={m.id} value={m.name}>
            {m.displayName || m.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
