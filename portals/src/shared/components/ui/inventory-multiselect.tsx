import { ChevronDown, Minus, Plus, Search, X } from 'lucide-react'
import type React from 'react'
import { useEffect, useMemo, useState } from 'react'
import { getInventoryItems } from '@/lib/actions/inventory'
import type { items } from '@/lib/db/schema'
import { useApiQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query-keys'
import { cn } from '@/lib/utils'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Checkbox } from '@/shared/components/ui/checkbox'
import { Input } from '@/shared/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/components/ui/popover'
import { ScrollArea } from '@/shared/components/ui/scroll-area'

type InventoryItem = typeof items.$inferSelect

type InventoryEntry = {
  id: string
  quantity: number
}

interface InventoryMultiSelectProps {
  value: InventoryEntry[] // Array of { id, quantity }
  onChange: (value: InventoryEntry[]) => void
  placeholder?: string
  disabled?: boolean
  className?: string
}

export function InventoryMultiSelect({
  value,
  onChange,
  placeholder = 'Select inventory items...',
  disabled = false,
  className,
}: InventoryMultiSelectProps) {
  const [open, setOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const inventoryQuery = useApiQuery(queryKeys.inventory.list(), () => getInventoryItems())
  const inventoryList = (inventoryQuery.data ?? []) as InventoryItem[]
  const isLoading = inventoryQuery.isLoading

  // Filter inventory items based on search query
  const filteredItems = useMemo(() => {
    if (!searchQuery.trim()) {
      return inventoryList
    }
    const query = searchQuery.toLowerCase()
    return inventoryList.filter(
      (item) =>
        item.name.toLowerCase().includes(query) ||
        item.sku?.toLowerCase().includes(query) ||
        item.category?.toLowerCase().includes(query)
    )
  }, [inventoryList, searchQuery])

  // Get selected inventory items with their quantities
  const selectedItems = useMemo(() => {
    return value
      .map((entry) => {
        const item = inventoryList.find((i) => i.id === entry.id)
        return item ? { ...item, quantity: entry.quantity } : null
      })
      .filter(Boolean) as (InventoryItem & { quantity: number })[]
  }, [inventoryList, value])

  const toggleItem = (itemId: string) => {
    const existing = value.find((entry) => entry.id === itemId)
    if (existing) {
      onChange(value.filter((entry) => entry.id !== itemId))
    } else {
      onChange([...value, { id: itemId, quantity: 1 }])
    }
  }

  const updateQuantity = (itemId: string, delta: number) => {
    onChange(
      value.map((entry) => {
        if (entry.id === itemId) {
          const newQuantity = Math.max(1, entry.quantity + delta)
          return { ...entry, quantity: newQuantity }
        }
        return entry
      })
    )
  }

  const removeItem = (itemId: string, e: React.MouseEvent | React.KeyboardEvent) => {
    e.stopPropagation()
    onChange(value.filter((entry) => entry.id !== itemId))
  }

  const getQuantity = (itemId: string) => {
    const entry = value.find((e) => e.id === itemId)
    return entry?.quantity || 0
  }

  // Reset search when popover closes
  useEffect(() => {
    if (!open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSearchQuery('')
    }
  }, [open])

  return (
    <div className="space-y-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className={cn(
              'w-full justify-between min-h-[40px] h-auto',
              !value.length && 'text-muted-foreground',
              className
            )}
            disabled={disabled}
          >
            <div className="flex flex-wrap gap-1 flex-1">
              {selectedItems.length === 0 ? (
                <span className="text-muted-foreground">{placeholder}</span>
              ) : (
                selectedItems.map((item) => (
                  <Badge key={item.id} variant="secondary" className="mr-1 mb-1">
                    {item.name} ({item.quantity})
                    <span
                      role="button"
                      tabIndex={0}
                      className="ml-1 ring-offset-background rounded-full outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 cursor-pointer inline-flex items-center justify-center"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          removeItem(item.id, e)
                        }
                      }}
                      onMouseDown={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                      }}
                      onClick={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        removeItem(item.id, e)
                      }}
                    >
                      <X className="h-3 w-3 text-muted-foreground hover:text-foreground" />
                    </span>
                  </Badge>
                ))
              )}
            </div>
            <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[400px] p-0" align="start">
          <div className="p-2 border-b">
            <div className="relative">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search inventory items..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8"
              />
            </div>
          </div>
          <ScrollArea className="h-[300px]">
            {isLoading ? (
              <div className="p-4 text-center text-sm text-muted-foreground">
                Loading inventory items...
              </div>
            ) : filteredItems.length === 0 ? (
              <div className="p-4 text-center text-sm text-muted-foreground">
                No inventory items found.
              </div>
            ) : (
              <div className="p-2">
                {filteredItems.map((item) => {
                  const isSelected = value.some((e) => e.id === item.id)
                  const quantity = getQuantity(item.id)
                  return (
                    <div
                      key={item.id}
                      className="flex items-center space-x-2 p-2 hover:bg-accent rounded-md"
                    >
                      <Checkbox checked={isSelected} onCheckedChange={() => toggleItem(item.id)} />
                      <label className="flex-1 cursor-pointer">
                        <span className="font-medium">{item.name}</span>
                        {item.sku && (
                          <span className="text-xs text-muted-foreground ml-2">
                            (SKU: {item.sku})
                          </span>
                        )}
                      </label>
                      {isSelected && (
                        <div
                          className="flex items-center gap-2"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            className="h-7 w-7"
                            onClick={(e) => {
                              e.stopPropagation()
                              updateQuantity(item.id, -1)
                            }}
                          >
                            <Minus className="h-3 w-3" />
                          </Button>
                          <span className="w-8 text-center text-sm font-medium">{quantity}</span>
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            className="h-7 w-7"
                            onClick={(e) => {
                              e.stopPropagation()
                              updateQuantity(item.id, 1)
                            }}
                          >
                            <Plus className="h-3 w-3" />
                          </Button>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </ScrollArea>
        </PopoverContent>
      </Popover>
    </div>
  )
}
