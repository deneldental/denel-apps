import { Banknote, Calendar, ShieldCheck, ShieldOff } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Card } from '@/shared/components/ui/card'

export type CheckInPaymentType = 'one-time' | 'plan' | 'no-payment' | 'insurance'

interface CheckInPaymentCardGridProps {
  /** Whether the "Payment plan" card is available (only for ortho patients). */
  planAvailable?: boolean
  /** Called with the selected payment type. */
  onSelect: (type: CheckInPaymentType) => void
}

interface CardDef {
  type: CheckInPaymentType
  title: string
  description: string
  Icon: typeof Banknote
  disabled?: boolean
}

/**
 * 2×2 card grid for the check-in payment dialog (M3.2 — Phase B).
 *
 * Displays four payment options as clickable cards. On md+ screens the
 * cards render as a 2×2 grid; on mobile they stack into a single column.
 * Each card exposes a clear hover + focus state and calls `onSelect` with
 * its payment type when activated.
 */
export function CheckInPaymentCardGrid({
  planAvailable = true,
  onSelect,
}: CheckInPaymentCardGridProps) {
  const cards: CardDef[] = [
    {
      type: 'one-time',
      title: 'One-time payment',
      description: 'Pay for specific treatments now',
      Icon: Banknote,
    },
    {
      type: 'plan',
      title: 'Payment plan',
      description: planAvailable
        ? 'Record an installment toward an existing plan'
        : 'No active plan for this patient',
      Icon: Calendar,
      disabled: !planAvailable,
    },
    {
      type: 'no-payment',
      title: 'No payment',
      description: 'Skip payment; appointment was already settled or no charge',
      Icon: ShieldOff,
    },
    {
      type: 'insurance',
      title: 'Insurance',
      description: 'Covered by an insurance company',
      Icon: ShieldCheck,
    },
  ]

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {cards.map(({ type, title, description, Icon, disabled }) => (
        <Card
          key={type}
          role="button"
          tabIndex={disabled ? -1 : 0}
          aria-disabled={disabled || undefined}
          onClick={() => {
            if (!disabled) onSelect(type)
          }}
          onKeyDown={(e) => {
            if (disabled) return
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              onSelect(type)
            }
          }}
          className={cn(
            'group flex flex-col items-start gap-2 p-4 transition-colors outline-none',
            'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
            disabled
              ? 'cursor-not-allowed opacity-50'
              : 'cursor-pointer hover:border-primary hover:bg-accent'
          )}
        >
          <div
            className={cn(
              'flex h-10 w-10 items-center justify-center rounded-md bg-muted',
              !disabled && 'group-hover:bg-primary/10'
            )}
          >
            <Icon className="h-5 w-5 text-foreground" />
          </div>
          <div className="font-medium leading-none">{title}</div>
          <div className="text-sm text-muted-foreground">{description}</div>
        </Card>
      ))}
    </div>
  )
}
