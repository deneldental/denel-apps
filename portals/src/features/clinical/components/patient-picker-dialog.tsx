import { Search, User } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '@/lib/api-client'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'
import { Input } from '@/shared/components/ui/input'
import { Skeleton } from '@/shared/components/ui/skeleton'

type Patient = { id: string; name: string; patientId: string | null; phone?: string | null }

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (patient: { id: string; name: string; patientId: string | null }) => void
  title?: string
  description?: string
}

export function PatientPickerDialog({
  open,
  onOpenChange,
  onSelect,
  title = 'Select patient',
  description,
}: Props) {
  const [query, setQuery] = useState('')
  const [patients, setPatients] = useState<Patient[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open) {
      setQuery('')
      setPatients([])
      return
    }
    setLoading(true)
    const t = setTimeout(async () => {
      const qs = query ? `?search=${encodeURIComponent(query)}&limit=20` : '?limit=20'
      const res = await api.get<Patient[]>(`/api/patients${qs}`)
      if (res.success && res.data) setPatients(res.data as Patient[])
      setLoading(false)
    }, 200)
    return () => clearTimeout(t)
  }, [query, open])

  function handleSelect(p: Patient) {
    onSelect({ id: p.id, name: p.name, patientId: p.patientId })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name or patient ID…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
            autoFocus
          />
        </div>

        <div className="mt-1 max-h-72 overflow-y-auto space-y-1">
          {loading ? (
            <>
              <Skeleton className="h-12 w-full rounded-lg" />
              <Skeleton className="h-12 w-full rounded-lg" />
              <Skeleton className="h-12 w-full rounded-lg" />
            </>
          ) : patients.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <User className="h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">
                {query ? 'No patients found' : 'Start typing to search'}
              </p>
            </div>
          ) : (
            patients.map((p) => (
              <Button
                key={p.id}
                variant="ghost"
                className="w-full justify-start h-auto px-3 py-2.5 text-left"
                onClick={() => handleSelect(p)}
              >
                <div className="flex flex-col gap-0.5 min-w-0">
                  <span className="font-medium text-sm truncate">{p.name}</span>
                  <div className="flex items-center gap-2">
                    {p.patientId && (
                      <Badge variant="outline" className="font-mono text-[10px] h-4 px-1.5">
                        {p.patientId}
                      </Badge>
                    )}
                    {p.phone && <span className="text-xs text-muted-foreground">{p.phone}</span>}
                  </div>
                </div>
              </Button>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
