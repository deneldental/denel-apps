import { Check, ChevronDown, Search, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { api } from '@/lib/api-client'
import { cn } from '@/lib/utils'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/components/ui/popover'
import { ScrollArea } from '@/shared/components/ui/scroll-area'

export type LookupOption = {
  id: string
  name: string
  displayName: string | null
  isActive?: boolean
}

export type LookupSelection = {
  id: string
  name: string
  displayName: string | null
}

interface LookupMultiSelectProps {
  /** Lookup type slug — matches the backend `/api/lookups/:type` route. */
  type: string
  value: LookupSelection[]
  onChange: (value: LookupSelection[]) => void
  placeholder?: string
  disabled?: boolean
  className?: string
}

/**
 * Generic multi-select bound to a `/api/lookups/:type` endpoint. Stores a
 * snapshot of `{ id, name, displayName }` per pick so stage payloads remain
 * readable even if a lookup row is later renamed or deactivated.
 */
export function LookupMultiSelect({
  type,
  value,
  onChange,
  placeholder = 'Select…',
  disabled,
  className,
}: LookupMultiSelectProps) {
  const [open, setOpen] = useState(false)
  const [options, setOptions] = useState<LookupOption[]>([])
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState('')

  useEffect(() => {
    let alive = true
    setLoading(true)
    api.get<LookupOption[]>(`/api/lookups/${type}`).then((res) => {
      if (!alive) return
      if (res.success && res.data) setOptions(res.data as LookupOption[])
      setLoading(false)
    })
    return () => {
      alive = false
    }
  }, [type])

  const selectedIds = useMemo(() => new Set(value.map((v) => v.id)), [value])

  const filtered = useMemo(() => {
    if (!query.trim()) return options
    const q = query.toLowerCase()
    return options.filter(
      (o) => o.name.toLowerCase().includes(q) || o.displayName?.toLowerCase().includes(q)
    )
  }, [options, query])

  const toggle = (option: LookupOption) => {
    if (selectedIds.has(option.id)) {
      onChange(value.filter((v) => v.id !== option.id))
    } else {
      onChange([
        ...value,
        { id: option.id, name: option.name, displayName: option.displayName ?? null },
      ])
    }
  }

  const remove = (id: string, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    onChange(value.filter((v) => v.id !== id))
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            'h-auto min-h-9 w-full justify-between text-left font-normal',
            !value.length && 'text-muted-foreground',
            className
          )}
        >
          <div className="flex flex-1 flex-wrap gap-1">
            {value.length === 0 ? (
              <span>{placeholder}</span>
            ) : (
              value.map((v) => (
                <Badge key={v.id} variant="secondary" className="text-xs">
                  {v.displayName ?? v.name}
                  <div
                    role="button"
                    tabIndex={0}
                    aria-label={`Remove ${v.displayName ?? v.name}`}
                    className="ml-1 rounded outline-none ring-offset-background focus:ring-2 focus:ring-ring focus:ring-offset-2 cursor-pointer"
                    onClick={(e) => remove(v.id, e)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') remove(v.id, e as any)
                    }}
                  >
                    <X className="h-3 w-3" />
                  </div>
                </Badge>
              ))
            )}
          </div>
          <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <div className="border-b p-2">
          <div className="relative">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search…"
              className="h-8 pl-8 text-sm"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>
        <ScrollArea className="max-h-64">
          {loading ? (
            <p className="p-4 text-center text-xs text-muted-foreground">Loading…</p>
          ) : options.length === 0 ? (
            // An unconfigured catalogue and a search that matched nothing are
            // very different problems; saying "No options found" for both makes
            // an empty lookup table look like a failed fetch.
            <p className="p-4 text-center text-xs text-muted-foreground">
              No options configured yet — add them under Settings.
            </p>
          ) : filtered.length === 0 ? (
            <p className="p-4 text-center text-xs text-muted-foreground">
              No matches for “{query.trim()}”.
            </p>
          ) : (
            <ul className="p-1">
              {filtered.map((opt) => {
                const isSelected = selectedIds.has(opt.id)
                return (
                  <li key={opt.id}>
                    <button
                      type="button"
                      onClick={() => toggle(opt)}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
                    >
                      <span
                        className={cn(
                          'flex h-4 w-4 items-center justify-center rounded border',
                          isSelected
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'border-input'
                        )}
                      >
                        {isSelected && <Check className="h-3 w-3" />}
                      </span>
                      <span className="flex-1 truncate">{opt.displayName ?? opt.name}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  )
}
