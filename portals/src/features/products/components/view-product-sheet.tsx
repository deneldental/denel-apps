import type { Product } from '@/features/products/pages/columns'
import { cn } from '@/lib/utils'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/shared/components/ui/sheet'
import { formatAmount } from '@/shared/utils/currency'

interface ViewProductSheetProps {
  product: Product
  open: boolean
  onOpenChange: (v: boolean) => void
  onEdit?: () => void
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="py-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-0.5">
        {label}
      </p>
      <div className="text-sm">{children}</div>
    </div>
  )
}

export function ViewProductSheet({ product, open, onOpenChange, onEdit }: ViewProductSheetProps) {
  const costPrice = product.costPrice != null ? Number(product.costPrice) : null
  const sellingPrice = Number(product.price ?? 0)
  const profit = costPrice != null ? sellingPrice - costPrice : null
  const profitMargin =
    costPrice && costPrice > 0 && profit != null ? ((profit / costPrice) * 100).toFixed(1) : null
  const reorderLevel = product.reorderLevel ?? 10
  const stockQty = product.stockQuantity ?? 0
  const sizeStr = [product.sizeValue, product.sizeUnit].filter(Boolean).join(' ') || '—'

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-md flex flex-col gap-0 p-0">
        <SheetHeader className="p-6 pb-4 border-b">
          <SheetTitle>{product.name}</SheetTitle>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 divide-y divide-border">
          {/* Image */}
          <Field label="Image">
            {product.image ? (
              <img
                src={product.image}
                alt={product.name}
                className="max-h-40 object-contain rounded-lg border"
              />
            ) : (
              <div className="flex h-24 items-center justify-center rounded-lg border bg-muted text-xs text-muted-foreground">
                No image
              </div>
            )}
          </Field>

          <Field label="SKU">
            <span className="font-mono">{product.sku || '—'}</span>
          </Field>

          <Field label="Category">{product.category || '—'}</Field>

          <Field label="Size">{sizeStr}</Field>

          <Field label="Selling price">GHS {formatAmount(Number(sellingPrice))}</Field>

          <Field label="Cost price">
            {costPrice != null ? `GHS ${formatAmount(Number(costPrice))}` : '—'}
          </Field>

          <Field label="Profit / margin">
            {profit != null ? (
              <span
                className={cn('font-medium', profit >= 0 ? 'text-green-600' : 'text-destructive')}
              >
                {profit >= 0 ? '+' : ''}GHS {formatAmount(Number(profit))}
                {profitMargin && ` (${profitMargin}%)`}
              </span>
            ) : (
              '—'
            )}
          </Field>

          <Field label="Quantity per pack">{product.quantityPerPack ?? '—'}</Field>

          <Field label="Stock (packs)">
            <span className={cn('font-medium', stockQty <= reorderLevel ? 'text-destructive' : '')}>
              {stockQty}
            </span>
            {stockQty <= reorderLevel && (
              <span className="ml-1.5 text-xs text-destructive">
                (below reorder level of {reorderLevel})
              </span>
            )}
          </Field>

          <Field label="Reorder level">{reorderLevel}</Field>

          <Field label="Status">
            {product.isLocked ? (
              <Badge variant="outline">Locked</Badge>
            ) : (
              <Badge variant="secondary">Unlocked</Badge>
            )}
          </Field>

          {product.description && (
            <Field label="Description">
              <p className="whitespace-pre-wrap">{product.description}</p>
            </Field>
          )}
        </div>

        <SheetFooter className="p-6 pt-4 border-t gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          {onEdit && <Button onClick={onEdit}>Edit</Button>}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
