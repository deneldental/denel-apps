import { format } from 'date-fns'
import { ClipboardList, Minus, Plus, Receipt, Trash2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { todaySalesCart, useTodaySalesCart } from '@/features/products/hooks/use-today-sales-cart'
import { Button } from '@/shared/components/ui/button'
import { formatCurrency } from '@/shared/utils/currency'

const fmt = formatCurrency

interface TodaySalesPanelProps {
  disabled?: boolean
}

export function TodaySalesPanel({ disabled = false }: TodaySalesPanelProps) {
  const cart = useTodaySalesCart()
  const navigate = useNavigate()

  const totalSales = cart.items.reduce((s, i) => s + i.unitPrice * i.quantity, 0)
  const totalUnits = cart.items.reduce((s, i) => s + i.quantity, 0)

  return (
    <div className="flex h-full min-h-0 flex-col rounded-lg border border-border bg-card">
      <div className="shrink-0 border-b border-border px-4 pt-3 pb-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Today</p>
        <p className="text-base font-semibold leading-tight">
          {format(new Date(), 'MMMM d, yyyy')}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {cart.items.length} {cart.items.length === 1 ? 'item' : 'items'} · {totalUnits} units
        </p>
      </div>

      <div className="flex-1 min-h-0 divide-y divide-border overflow-y-auto">
        {cart.items.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 px-4 py-12 text-center">
            <Receipt className="h-8 w-8 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">No sales yet today</p>
            <p className="text-xs text-muted-foreground/60">
              Click “Add to Sales” on a product to start.
            </p>
          </div>
        ) : (
          cart.items.map((item) => (
            <div key={item.productId} className="flex items-center gap-2 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{item.name}</p>
                <p className="text-xs text-muted-foreground">
                  {fmt(item.unitPrice)} × {item.quantity} ·{' '}
                  <span className="font-medium text-foreground">
                    {fmt(item.unitPrice * item.quantity)}
                  </span>
                </p>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => todaySalesCart.decrement(item.productId)}
                  disabled={disabled}
                  title={item.quantity <= 1 ? 'Remove' : 'Decrease'}
                  aria-label={item.quantity <= 1 ? 'Remove' : 'Remove'}
                >
                  {item.quantity <= 1 ? (
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  ) : (
                    <Minus className="h-3.5 w-3.5" />
                  )}
                </Button>
                <span className="w-6 text-center text-sm font-medium tabular-nums">
                  {item.quantity}
                </span>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() =>
                    todaySalesCart.add({
                      productId: item.productId,
                      name: item.name,
                      unitPrice: item.unitPrice,
                      costPrice: item.costPrice,
                    })
                  }
                  disabled={disabled}
                  title="Increase"
                  aria-label="Add"
                >
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="shrink-0 space-y-3 border-t border-border bg-muted/30 px-4 py-3">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Total</span>
          <span className="text-base font-semibold">{fmt(totalSales)}</span>
        </div>
        <Button
          className="w-full"
          size="sm"
          onClick={() => navigate('/reports?openReport=1')}
          disabled={disabled || cart.items.length === 0}
        >
          <ClipboardList className="mr-2 h-4 w-4" />
          Add to Daily Report
        </Button>
        <p className="text-[11px] leading-tight text-muted-foreground">
          These items are saved on this device only. They are written to the database when the daily
          report is submitted.
        </p>
      </div>
    </div>
  )
}
