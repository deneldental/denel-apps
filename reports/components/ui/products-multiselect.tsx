import { ChevronDown, Minus, Plus, Search, X } from 'lucide-react'
import React, { useEffect, useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ScrollArea } from '@/components/ui/scroll-area'
import { getProducts } from '@/lib/actions/products'
import type { products } from '@/lib/db/schema'
import { cn } from '@/lib/utils'

type Product = typeof products.$inferSelect

type ProductEntry = {
  id: string
  quantity: number
}

interface ProductsMultiSelectProps {
  value: ProductEntry[] // Array of { id, quantity }
  onChange: (value: ProductEntry[]) => void
  placeholder?: string
  disabled?: boolean
  className?: string
}

export function ProductsMultiSelect({
  value,
  onChange,
  placeholder = 'Select products...',
  disabled = false,
  className,
}: ProductsMultiSelectProps) {
  const [open, setOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [productsList, setProductsList] = useState<Product[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const loadProducts = React.useCallback(async () => {
    setIsLoading(true)
    const result = await getProducts()
    if (result.success && result.data) {
      setProductsList(result.data)
    }
    setIsLoading(false)
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadProducts()
  }, [loadProducts])

  // Filter products based on search query
  const filteredProducts = useMemo(() => {
    if (!searchQuery.trim()) {
      return productsList
    }
    const query = searchQuery.toLowerCase()
    return productsList.filter(
      (product) =>
        product.name.toLowerCase().includes(query) ||
        product.sku?.toLowerCase().includes(query) ||
        product.category?.toLowerCase().includes(query)
    )
  }, [productsList, searchQuery])

  // Get selected products with their quantities
  const selectedProducts = useMemo(() => {
    return value
      .map((entry) => {
        const product = productsList.find((p) => p.id === entry.id)
        return product ? { ...product, quantity: entry.quantity } : null
      })
      .filter(Boolean) as (Product & { quantity: number })[]
  }, [productsList, value])

  const toggleProduct = (productId: string) => {
    const existing = value.find((entry) => entry.id === productId)
    if (existing) {
      onChange(value.filter((entry) => entry.id !== productId))
    } else {
      onChange([...value, { id: productId, quantity: 1 }])
    }
  }

  const updateQuantity = (productId: string, delta: number) => {
    onChange(
      value.map((entry) => {
        if (entry.id === productId) {
          const newQuantity = Math.max(1, entry.quantity + delta)
          return { ...entry, quantity: newQuantity }
        }
        return entry
      })
    )
  }

  const removeProduct = (productId: string, e: React.MouseEvent | React.KeyboardEvent) => {
    e.stopPropagation()
    onChange(value.filter((entry) => entry.id !== productId))
  }

  const getQuantity = (productId: string) => {
    const entry = value.find((e) => e.id === productId)
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
              {selectedProducts.length === 0 ? (
                <span className="text-muted-foreground">{placeholder}</span>
              ) : (
                selectedProducts.map((product) => (
                  <Badge key={product.id} variant="secondary" className="mr-1 mb-1">
                    {product.name} ({product.quantity})
                    <span
                      role="button"
                      tabIndex={0}
                      className="ml-1 ring-offset-background rounded-full outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 cursor-pointer inline-flex items-center justify-center"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          removeProduct(product.id, e)
                        }
                      }}
                      onMouseDown={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                      }}
                      onClick={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        removeProduct(product.id, e)
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
                placeholder="Search products..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8"
              />
            </div>
          </div>
          <ScrollArea className="h-[300px]">
            {isLoading ? (
              <div className="p-4 text-center text-sm text-muted-foreground">
                Loading products...
              </div>
            ) : filteredProducts.length === 0 ? (
              <div className="p-4 text-center text-sm text-muted-foreground">
                No products found.
              </div>
            ) : (
              <div className="p-2">
                {filteredProducts.map((product) => {
                  const isSelected = value.some((e) => e.id === product.id)
                  const quantity = getQuantity(product.id)
                  return (
                    <div
                      key={product.id}
                      className="flex items-center space-x-2 p-2 hover:bg-accent rounded-md"
                    >
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => toggleProduct(product.id)}
                      />
                      <label className="flex-1 cursor-pointer">
                        <span className="font-medium">{product.name}</span>
                        {product.sku && (
                          <span className="text-xs text-muted-foreground ml-2">
                            (SKU: {product.sku})
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
                              updateQuantity(product.id, -1)
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
                              updateQuantity(product.id, 1)
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
