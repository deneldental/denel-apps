import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { Switch } from '@/shared/components/ui/switch'

interface ExpiryDateFieldProps {
  /** Whether this item is tracked with an expiry date. */
  hasExpiry: boolean
  onHasExpiryChange: (next: boolean) => void
  /** `yyyy-MM-dd`, the value an `<input type="date">` expects. Empty when unset. */
  expiryDate: string
  onExpiryDateChange: (next: string) => void
  /** Prefixes the input id so add/edit forms on one page keep unique ids. */
  idPrefix: string
}

/**
 * "Expiry product" toggle + the date input it reveals. Shared by the inventory
 * and product forms so both capture expiry the same way.
 *
 * Turning the toggle off clears the date — a hidden field holding a stale value
 * would be saved on the next submit and silently resurrect an expiry the user
 * meant to drop.
 */
export function ExpiryDateField({
  hasExpiry,
  onHasExpiryChange,
  expiryDate,
  onExpiryDateChange,
  idPrefix,
}: ExpiryDateFieldProps) {
  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-0.5">
          <Label htmlFor={`${idPrefix}-hasExpiry`} className="cursor-pointer">
            Expiry product
          </Label>
          <p className="text-xs text-muted-foreground">
            Turn on for items that expire, then set the date below.
          </p>
        </div>
        <Switch
          id={`${idPrefix}-hasExpiry`}
          checked={hasExpiry}
          onCheckedChange={(next) => {
            onHasExpiryChange(next)
            if (!next) onExpiryDateChange('')
          }}
          aria-label="Track an expiry date for this item"
        />
      </div>

      {hasExpiry && (
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-expiryDate`}>Expiry date</Label>
          <Input
            id={`${idPrefix}-expiryDate`}
            type="date"
            value={expiryDate}
            onChange={(e) => onExpiryDateChange(e.target.value)}
          />
        </div>
      )}
    </div>
  )
}

/** Normalises a stored expiry (Date | ISO string | null) to a date-input value. */
export function toExpiryInput(value: unknown): string {
  if (!value) return ''
  const d = new Date(value as string)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => `${n}`.padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
