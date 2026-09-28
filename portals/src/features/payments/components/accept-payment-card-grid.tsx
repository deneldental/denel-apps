import { Banknote, Calendar, CircleSlash, ShieldCheck } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Card } from '@/shared/components/ui/card'

export type AcceptPaymentType = 'one-time' | 'plan' | 'insurance' | 'no-payment'

interface AcceptPaymentCardGridProps {
  /** Called with the selected payment type. */
  onSelect: (type: AcceptPaymentType) => void
  /** Show the "No payment" card. Defaults to false — that card only makes
   *  sense from the appointment check-in flow, where it represents the
   *  receptionist checking the patient in without taking any money (with a
   *  short reason captured for the record). */
  includeNoPayment?: boolean
}

interface CardDef {
  type: AcceptPaymentType
  title: string
  description: string
  Icon: typeof Banknote
}

/**
 * Card grid for the Accept Payment dialog (M5.3 — Phase B).
 *
 * Every option sits in ONE row on md+ screens — three columns normally, four
 * when the "No payment" card is included — and collapses to a single column
 * below md, where a row of cards would be too narrow to read.
 *
 * The host panel must be wide enough for the row: Tailwind's `md:` breakpoint
 * is viewport-based, not container-based, so a desktop viewport fires it
 * regardless of how narrow the sheet is. `AcceptPaymentSheet` widens itself to
 * match; any new caller in a narrow container needs to do the same.
 */
export function AcceptPaymentCardGrid({
  onSelect,
  includeNoPayment = false,
}: AcceptPaymentCardGridProps) {
  const cards: CardDef[] = [
    {
      type: 'one-time',
      title: 'One-time payment',
      description: 'Record a one-off payment for treatments',
      Icon: Banknote,
    },
    {
      type: 'plan',
      title: 'Payment plan',
      description: "Record an installment on a patient's plan",
      Icon: Calendar,
    },
    {
      type: 'insurance',
      title: 'Insurance',
      description: 'Covered by an insurance company',
      Icon: ShieldCheck,
    },
    ...(includeNoPayment
      ? ([
          {
            type: 'no-payment',
            title: 'No payment',
            description: 'Check in without taking any money — capture a reason',
            Icon: CircleSlash,
          },
        ] as CardDef[])
      : []),
  ]

  return (
    <div
      className={cn(
        'grid grid-cols-1 gap-3',
        cards.length === 4 ? 'md:grid-cols-4' : 'md:grid-cols-3'
      )}
    >
      {cards.map(({ type, title, description, Icon }) => (
        <Card
          key={type}
          role="button"
          tabIndex={0}
          onClick={() => onSelect(type)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              onSelect(type)
            }
          }}
          className={cn(
            'group flex h-full cursor-pointer flex-col items-start gap-2 p-4',
            'outline-none transition-colors',
            'hover:border-primary hover:bg-accent',
            'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
          )}
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted group-hover:bg-primary/10">
            <Icon className="h-5 w-5 text-foreground" />
          </div>
          <div className="font-medium leading-tight">{title}</div>
          <div className="text-sm leading-snug text-muted-foreground">{description}</div>
        </Card>
      ))}
    </div>
  )
}
