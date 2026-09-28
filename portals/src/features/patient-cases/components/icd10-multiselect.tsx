import { Check, ChevronDown, Search, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { type Icd10Code, searchIcd10Codes } from '@/lib/actions/icd10-codes'
import { useApiQuery } from '@/lib/query'
import { cn } from '@/lib/utils'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/components/ui/popover'
import { ScrollArea } from '@/shared/components/ui/scroll-area'

// admin-v1 CC.1 / §2.2 — coded ICD-10 diagnosis picker.
// A debounced type-ahead multi-select against /api/icd10-codes. Each pick stores
// a `{ code, title }` snapshot so the diagnosis stage stays readable even if the
// reference row is later revised. Mirrors LookupMultiSelect's popover UX, but the
// option list is fetched live per query rather than loaded up-front.

export type Icd10Selection = {
  code: string
  title: string
}

interface Props {
  value: Icd10Selection[]
  onChange: (value: Icd10Selection[]) => void
  placeholder?: string
  className?: string
}

export function Icd10MultiSelect({
  value,
  onChange,
  placeholder = 'Search ICD-10 codes…',
  className,
}: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')

  // Debounce the live search — only fires while the popover is open.
  useEffect(() => {
    if (!open) return
    const handle = setTimeout(() => setDebouncedQuery(query), 250)
    return () => clearTimeout(handle)
  }, [query, open])

  const searchQuery = useApiQuery(
    ['icd10-codes', 'search', debouncedQuery] as const,
    () => searchIcd10Codes(debouncedQuery, 25),
    { enabled: open }
  )
  const options = searchQuery.data ?? []
  const loading = searchQuery.isFetching

  const selectedCodes = useRef<Set<string>>(new Set())
  selectedCodes.current = new Set(value.map((v) => v.code))

  const toggle = (opt: Icd10Code) => {
    if (selectedCodes.current.has(opt.code)) {
      onChange(value.filter((v) => v.code !== opt.code))
    } else {
      onChange([...value, { code: opt.code, title: opt.title }])
    }
  }

  const remove = (code: string, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    onChange(value.filter((v) => v.code !== code))
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
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
                <Badge key={v.code} variant="secondary" className="text-xs">
                  <span className="font-mono">{v.code}</span>
                  <span className="ml-1 truncate max-w-[12rem]">{v.title}</span>
                  <div
                    role="button"
                    tabIndex={0}
                    aria-label={`Remove ${v.code}`}
                    className="ml-1 rounded outline-none ring-offset-background focus:ring-2 focus:ring-ring focus:ring-offset-2 cursor-pointer"
                    onClick={(e) => remove(v.code, e)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') remove(v.code, e as any)
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
              placeholder="Search by code or title…"
              className="h-8 pl-8 text-sm"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>
        <ScrollArea className="max-h-64">
          {loading ? (
            <p className="p-4 text-center text-xs text-muted-foreground">Searching…</p>
          ) : options.length === 0 ? (
            <p className="p-4 text-center text-xs text-muted-foreground">
              {query.trim() ? 'No matching codes.' : 'Type to search ICD-10 codes.'}
            </p>
          ) : (
            <ul className="p-1">
              {options.map((opt) => {
                const isSelected = selectedCodes.current.has(opt.code)
                return (
                  <li key={opt.id}>
                    <button
                      type="button"
                      onClick={() => toggle(opt)}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
                    >
                      <span
                        className={cn(
                          'flex h-4 w-4 items-center justify-center rounded border shrink-0',
                          isSelected
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'border-input'
                        )}
                      >
                        {isSelected && <Check className="h-3 w-3" />}
                      </span>
                      <span className="font-mono text-xs shrink-0 w-16">{opt.code}</span>
                      <span className="flex-1 truncate">{opt.title}</span>
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
