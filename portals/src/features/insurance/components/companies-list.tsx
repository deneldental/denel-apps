import { Building2 } from 'lucide-react'
import { Badge } from '@/shared/components/ui/badge'
import type { InsuranceCompany } from '../types'

interface Props {
  companies: InsuranceCompany[]
  selectedId: string | null
  onSelect: (id: string) => void
}

export function CompaniesList({ companies, selectedId, onSelect }: Props) {
  if (companies.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border px-3 py-6 text-center">
        <p className="text-xs text-muted-foreground">No companies yet.</p>
      </div>
    )
  }

  return (
    <div className="space-y-1">
      {companies.map((c) => (
        <button
          key={c.id}
          type="button"
          onClick={() => onSelect(c.id)}
          className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-md text-left transition-colors ${
            selectedId === c.id
              ? 'bg-primary/10 text-foreground'
              : 'hover:bg-muted/50 text-muted-foreground hover:text-foreground'
          }`}
        >
          <Building2 className="h-3.5 w-3.5 shrink-0" />
          <span className="text-sm font-medium truncate flex-1">{c.name}</span>
          {!c.active && (
            <Badge variant="outline" className="text-[9px]">
              Inactive
            </Badge>
          )}
        </button>
      ))}
    </div>
  )
}
