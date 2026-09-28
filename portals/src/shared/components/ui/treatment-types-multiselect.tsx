import { ChevronDown, Search, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { getTreatmentTypes } from '@/lib/actions/treatment-types'
import type { treatmentTypes } from '@/lib/db/schema'
import { useApiQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query-keys'
import { cn } from '@/lib/utils'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Checkbox } from '@/shared/components/ui/checkbox'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/components/ui/popover'
import { ScrollArea } from '@/shared/components/ui/scroll-area'

type TreatmentType = typeof treatmentTypes.$inferSelect

interface TreatmentTypesMultiSelectProps {
  value: string[] // Array of treatment type IDs
  onChange: (value: string[]) => void
  placeholder?: string
  disabled?: boolean
  className?: string
}

export function TreatmentTypesMultiSelect({
  value,
  onChange,
  placeholder = 'Select service categories...',
  disabled = false,
  className,
}: TreatmentTypesMultiSelectProps) {
  const [open, setOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const typesQuery = useApiQuery<TreatmentType[]>(
    queryKeys.treatmentTypes.list(),
    getTreatmentTypes
  )
  const treatmentTypesList = typesQuery.data ?? []
  const isLoading = typesQuery.isLoading

  // Filter treatment types based on search query
  const filteredTypes = useMemo(() => {
    if (!searchQuery.trim()) {
      return treatmentTypesList
    }
    const query = searchQuery.toLowerCase()
    return treatmentTypesList.filter(
      (type) =>
        type.name.toLowerCase().includes(query) || type.displayName?.toLowerCase().includes(query)
    )
  }, [treatmentTypesList, searchQuery])

  // Get selected treatment types
  const selectedTypes = useMemo(() => {
    return treatmentTypesList.filter((type) => value.includes(type.id))
  }, [treatmentTypesList, value])

  const toggleType = (typeId: string) => {
    if (value.includes(typeId)) {
      onChange(value.filter((id) => id !== typeId))
    } else {
      onChange([...value, typeId])
    }
  }

  const removeType = (typeId: string, e: React.MouseEvent | React.KeyboardEvent) => {
    e.stopPropagation()
    onChange(value.filter((id) => id !== typeId))
  }

  const getDisplayName = (type: TreatmentType) => {
    return type.displayName || type.name
  }

  // Reset search when popover closes - done during render to avoid cascading updates
  if (!open && searchQuery !== '') {
    setSearchQuery('')
  }

  return (
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
            {selectedTypes.length === 0 ? (
              <span className="text-muted-foreground">{placeholder}</span>
            ) : (
              selectedTypes.map((type) => (
                <Badge key={type.id} variant="secondary" className="mr-1 mb-1">
                  {getDisplayName(type)}
                  <span
                    role="button"
                    tabIndex={0}
                    className="ml-1 ring-offset-background rounded-full outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 cursor-pointer inline-flex items-center justify-center"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        removeType(type.id, e)
                      }
                    }}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                    }}
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      removeType(type.id, e)
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
              placeholder="Search service categories..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8"
            />
          </div>
        </div>
        <ScrollArea className="h-[300px]">
          {isLoading ? (
            <div className="p-4 text-center text-sm text-muted-foreground">
              Loading service categories...
            </div>
          ) : filteredTypes.length === 0 ? (
            <div className="p-4 text-center text-sm text-muted-foreground">
              No service categories found.
            </div>
          ) : (
            <div className="p-2">
              {filteredTypes.map((type) => (
                <div
                  key={type.id}
                  className="flex items-center space-x-2 p-2 hover:bg-accent rounded-md cursor-pointer"
                  onClick={() => toggleType(type.id)}
                >
                  <Checkbox
                    checked={value.includes(type.id)}
                    onCheckedChange={() => toggleType(type.id)}
                  />
                  <Label className="flex-1 cursor-pointer">
                    <span className="font-medium">{getDisplayName(type)}</span>
                    {type.displayName && (
                      <span className="text-xs text-muted-foreground ml-2">({type.name})</span>
                    )}
                  </Label>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  )
}
