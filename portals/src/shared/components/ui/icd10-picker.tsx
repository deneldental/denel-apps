import { Check, ChevronsUpDown, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '@/lib/api-client'
import { cn } from '@/lib/utils'
import { Button } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/components/ui/popover'

export interface Icd10Code {
  code: string
  title: string
}

interface Props {
  value: string | null
  onChange: (code: string | null, item?: Icd10Code) => void
  disabled?: boolean
}

/** Type-ahead ICD-10 picker (admin-v1 CC.1). Searches /api/icd10-codes. */
export function Icd10Picker({ value, onChange, disabled }: Props) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [debounced, setDebounced] = useState('')
  const [results, setResults] = useState<Icd10Code[]>([])
  const [selectedTitle, setSelectedTitle] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 250)
    return () => clearTimeout(t)
  }, [q])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    api.get<Icd10Code[]>(`/api/icd10-codes?q=${encodeURIComponent(debounced)}`).then((res) => {
      if (cancelled) return
      setResults(res.success && res.data ? res.data : [])
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [open, debounced])

  // Resolve a label for an externally-set value.
  useEffect(() => {
    if (!value) {
      setSelectedTitle(null)
      return
    }
    let cancelled = false
    api.get<Icd10Code[]>(`/api/icd10-codes?q=${encodeURIComponent(value)}`).then((res) => {
      if (cancelled) return
      const match = res.success && res.data ? res.data.find((r) => r.code === value) : undefined
      setSelectedTitle(match?.title ?? null)
    })
    return () => {
      cancelled = true
    }
  }, [value])

  return (
    <div className="flex items-center gap-1">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className="flex-1 justify-between font-normal"
            disabled={disabled}
          >
            <span className="truncate text-left">
              {value ? (
                <span>
                  <span className="font-mono">{value}</span>
                  {selectedTitle ? ` · ${selectedTitle}` : ''}
                </span>
              ) : (
                <span className="text-muted-foreground">Select ICD-10 code…</span>
              )}
            </span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[360px] p-0" align="start">
          <div className="border-b p-2">
            <Input
              placeholder="Search code or title…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="h-8"
            />
          </div>
          <div className="max-h-[280px] overflow-y-auto p-1">
            {loading ? (
              <p className="p-3 text-center text-sm text-muted-foreground">Searching…</p>
            ) : results.length === 0 ? (
              <p className="p-3 text-center text-sm text-muted-foreground">No codes found.</p>
            ) : (
              results.map((r) => (
                <button
                  key={r.code}
                  type="button"
                  onClick={() => {
                    onChange(r.code, r)
                    setSelectedTitle(r.title)
                    setOpen(false)
                  }}
                  className="flex w-full items-start gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
                >
                  <Check
                    className={cn(
                      'mt-0.5 h-3.5 w-3.5 shrink-0',
                      value === r.code ? 'opacity-100' : 'opacity-0'
                    )}
                  />
                  <span>
                    <span className="font-mono">{r.code}</span> · {r.title}
                  </span>
                </button>
              ))
            )}
          </div>
        </PopoverContent>
      </Popover>
      {value && !disabled && (
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 shrink-0"
          onClick={() => {
            onChange(null)
            setSelectedTitle(null)
          }}
          aria-label="Clear ICD-10 code"
        >
          <X className="h-4 w-4" />
        </Button>
      )}
    </div>
  )
}
