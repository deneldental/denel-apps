import { Plus, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { api } from '@/lib/api-client'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent } from '@/shared/components/ui/card'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/shared/components/ui/sheet'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table'

const KV_KEY = 'monthly_threshold_items'

type ThresholdItem = {
  id: string
  inventoryItemId: string
  inventoryItemName: string
  costPrice: number
  quantity: number
}

type InventoryItem = {
  id: string
  name: string
  unit: string | null
  stockQuantity: number
}

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'GHS' }).format(n)

export default function MonthlyThresholdPage() {
  const [items, setItems] = useState<ThresholdItem[]>([])
  const [inventory, setInventory] = useState<InventoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [addOpen, setAddOpen] = useState(false)

  const loadItems = useCallback(async () => {
    const res = await api.get<{ items: ThresholdItem[] }>(`/api/settings/kv/${KV_KEY}`)
    if (res.success && res.data) {
      setItems(res.data.items ?? [])
    }
  }, [])

  const loadInventory = useCallback(async () => {
    const res = await api.get<InventoryItem[]>('/api/inventory')
    if (res.success && res.data) {
      setInventory(res.data)
    }
  }, [])

  useEffect(() => {
    Promise.all([loadItems(), loadInventory()]).finally(() => setLoading(false))
  }, [loadItems, loadInventory])

  const saveItems = async (next: ThresholdItem[]) => {
    const res = await api.put<any>(`/api/settings/kv/${KV_KEY}`, { value: { items: next } })
    if (!res.success) {
      toast.error('Failed to save')
      return false
    }
    return true
  }

  const handleRemove = async (id: string) => {
    const next = items.filter((i) => i.id !== id)
    if (await saveItems(next)) {
      setItems(next)
      toast.success('Item removed')
    }
  }

  const handleAdd = async (item: Omit<ThresholdItem, 'id'>) => {
    const next = [...items, { ...item, id: crypto.randomUUID() }]
    if (await saveItems(next)) {
      setItems(next)
      return true
    }
    return false
  }

  const totalCost = items.reduce((s, i) => s + i.costPrice * i.quantity, 0)

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Monthly Threshold</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Define target quantities for inventory items each month.
          </p>
        </div>
        <Button onClick={() => setAddOpen(true)}>
          <Plus className="mr-1.5 h-4 w-4" />
          Add Item
        </Button>
        <AddThresholdItemSheet
          open={addOpen}
          onOpenChange={setAddOpen}
          inventory={inventory}
          existingIds={items.map((i) => i.inventoryItemId)}
          onAdd={handleAdd}
        />
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Inventory Item</TableHead>
                <TableHead className="text-right">Cost Price</TableHead>
                <TableHead className="text-right">Monthly Target Qty</TableHead>
                <TableHead className="text-right">Est. Monthly Cost</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-20 text-center text-muted-foreground">
                    Loading…
                  </TableCell>
                </TableRow>
              ) : items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-20 text-center text-muted-foreground">
                    No threshold items yet. Add items to start tracking.
                  </TableCell>
                </TableRow>
              ) : (
                items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">{item.inventoryItemName}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(item.costPrice)}</TableCell>
                    <TableCell className="text-right tabular-nums">{item.quantity}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmt(item.costPrice * item.quantity)}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive hover:text-destructive"
                        onClick={() => handleRemove(item.id)}
                        aria-label="Delete"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {items.length > 0 && (
        <div className="flex justify-end">
          <p className="text-sm text-muted-foreground">
            Total estimated monthly cost:{' '}
            <span className="font-semibold text-foreground">{fmt(totalCost)}</span>
          </p>
        </div>
      )}
    </div>
  )
}

// ── Add Threshold Item Sheet ──────────────────────────────────────────────────

interface AddThresholdItemSheetProps {
  open: boolean
  onOpenChange: (v: boolean) => void
  inventory: InventoryItem[]
  existingIds: string[]
  onAdd: (item: Omit<ThresholdItem, 'id'>) => Promise<boolean>
}

function AddThresholdItemSheet({
  open,
  onOpenChange,
  inventory,
  existingIds,
  onAdd,
}: AddThresholdItemSheetProps) {
  const [inventoryItemId, setInventoryItemId] = useState('')
  const [costPrice, setCostPrice] = useState('')
  const [quantity, setQuantity] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      setInventoryItemId('')
      setCostPrice('')
      setQuantity('')
    }
  }, [open])

  const available = inventory.filter((i) => !existingIds.includes(i.id))
  const selectedItem = inventory.find((i) => i.id === inventoryItemId)

  const canSave =
    !!inventoryItemId &&
    costPrice.trim() !== '' &&
    !Number.isNaN(parseFloat(costPrice)) &&
    parseFloat(costPrice) >= 0 &&
    quantity.trim() !== '' &&
    !Number.isNaN(parseInt(quantity, 10)) &&
    parseInt(quantity, 10) > 0

  const handleSave = async () => {
    if (!canSave || !selectedItem) return
    setSaving(true)
    const ok = await onAdd({
      inventoryItemId,
      inventoryItemName: selectedItem.name,
      costPrice: parseFloat(costPrice),
      quantity: parseInt(quantity, 10),
    })
    setSaving(false)
    if (ok) {
      toast.success('Item added')
      onOpenChange(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-md flex flex-col gap-0 p-0">
        <SheetHeader className="p-6 pb-4 border-b">
          <SheetTitle>Add threshold item</SheetTitle>
          <SheetDescription>Set a monthly target quantity for an inventory item.</SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <div className="space-y-2">
            <Label>Inventory item</Label>
            <Select value={inventoryItemId} onValueChange={setInventoryItemId}>
              <SelectTrigger>
                <SelectValue placeholder="Select item…" />
              </SelectTrigger>
              <SelectContent>
                {available.length === 0 ? (
                  <SelectItem value="__none" disabled>
                    All inventory items already added
                  </SelectItem>
                ) : (
                  available.map((i) => (
                    <SelectItem key={i.id} value={i.id}>
                      {i.name}
                      {i.unit ? ` (${i.unit})` : ''}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="thr-cost">Cost price (GHS)</Label>
            <Input
              id="thr-cost"
              type="number"
              step="0.01"
              min="0"
              value={costPrice}
              onChange={(e) => setCostPrice(e.target.value)}
              placeholder="0.00"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="thr-qty">Monthly target quantity</Label>
            <Input
              id="thr-qty"
              type="number"
              min="1"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="e.g. 50"
            />
          </div>
        </div>

        <SheetFooter className="p-6 pt-4 border-t gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button disabled={!canSave || saving} onClick={handleSave}>
            {saving ? 'Adding…' : 'Add'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
