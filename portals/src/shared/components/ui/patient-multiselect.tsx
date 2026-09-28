import { ChevronDown, Search, X } from 'lucide-react'
import type React from 'react'
import { useEffect, useMemo, useState } from 'react'
import { getPatientsForSync } from '@/lib/actions/data-sync-preview'
import { useApiQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query-keys'
import { cn } from '@/lib/utils'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Checkbox } from '@/shared/components/ui/checkbox'
import { Input } from '@/shared/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/components/ui/popover'
import { ScrollArea } from '@/shared/components/ui/scroll-area'

interface PatientItem {
  id: string
  name: string
  patientId: string
}

interface PatientMultiSelectProps {
  value: string[] // Array of patient IDs
  onChange: (value: string[]) => void
  placeholder?: string
  disabled?: boolean
  className?: string
}

export function PatientMultiSelect({
  value,
  onChange,
  placeholder = 'Select patients...',
  disabled = false,
  className,
}: PatientMultiSelectProps) {
  const [open, setOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  // Same `/api/patients` list PatientPicker/useAppointmentPickers read — shares
  // that cache entry instead of its own independent fetch.
  const patientsQuery = useApiQuery(queryKeys.patients.list(), getPatientsForSync)
  const patientsList = (patientsQuery.data ?? []) as unknown as PatientItem[]
  const isLoading = patientsQuery.isLoading

  // Filter patients based on search query
  const filteredItems = useMemo(() => {
    if (!searchQuery.trim()) {
      return patientsList
    }
    const query = searchQuery.toLowerCase()
    return patientsList.filter(
      (item) =>
        item.name.toLowerCase().includes(query) || item.patientId?.toLowerCase().includes(query)
    )
  }, [patientsList, searchQuery])

  // Get selected patients
  const selectedItems = useMemo(() => {
    return value.map((id) => patientsList.find((p) => p.id === id)).filter(Boolean) as PatientItem[]
  }, [patientsList, value])

  const toggleItem = (patientId: string) => {
    if (value.includes(patientId)) {
      onChange(value.filter((id) => id !== patientId))
    } else {
      onChange([...value, patientId])
    }
  }

  const removeItem = (patientId: string, e: React.MouseEvent | React.KeyboardEvent) => {
    e.stopPropagation()
    onChange(value.filter((id) => id !== patientId))
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
                    {item.name}
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
                placeholder="Search patients..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8"
              />
            </div>
          </div>
          <ScrollArea className="h-[300px]">
            {isLoading ? (
              <div className="p-4 text-center text-sm text-muted-foreground">
                Loading patients...
              </div>
            ) : filteredItems.length === 0 ? (
              <div className="p-4 text-center text-sm text-muted-foreground">
                No patients found.
              </div>
            ) : (
              <div className="p-2">
                {filteredItems.map((item) => {
                  const isSelected = value.includes(item.id)
                  return (
                    <div
                      key={item.id}
                      className="flex items-center space-x-2 p-2 hover:bg-accent rounded-md"
                      onClick={() => toggleItem(item.id)}
                    >
                      <Checkbox checked={isSelected} onCheckedChange={() => toggleItem(item.id)} />
                      <label className="flex-1 cursor-pointer">
                        <span className="font-medium">{item.name}</span>
                        {item.patientId && (
                          <span className="text-xs text-muted-foreground ml-2">
                            ({item.patientId})
                          </span>
                        )}
                      </label>
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
