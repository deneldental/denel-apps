import { ShieldCheck } from 'lucide-react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card'
import { Label } from '@/shared/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select'

/**
 * admin-v1 §22.2 — per-section PII scope selector.
 *
 * Data crosses into the reports app's separate database, so the admin chooses
 * how sensitive patient PII (name / phone / dob / email / address …) is handled
 * before it leaves this DB. Persisted as `config.piiScope` via the section's
 * existing save path; the backend defaults to `include` when unset.
 */
export const PII_SCOPE_OPTIONS = [
  {
    value: 'include',
    label: 'Include full PII',
    hint: 'Send complete records, PII intact (default).',
  },
  {
    value: 'omit',
    label: 'Omit PII',
    hint: 'Strip PII fields — they never leave this database.',
  },
  {
    value: 'mask',
    label: 'Mask PII',
    hint: 'Replace PII values with anonymized tokens, keeping record shape.',
  },
] as const

export type PiiScope = (typeof PII_SCOPE_OPTIONS)[number]['value']

export const DEFAULT_PII_SCOPE: PiiScope = 'include'

export function isPiiScope(v: unknown): v is PiiScope {
  return PII_SCOPE_OPTIONS.some((o) => o.value === v)
}

export function PiiScopeCard({
  value,
  onChange,
}: {
  value: PiiScope
  onChange: (next: PiiScope) => void
}) {
  const active = PII_SCOPE_OPTIONS.find((o) => o.value === value) ?? PII_SCOPE_OPTIONS[0]

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-muted-foreground" />
          <CardTitle className="text-base">PII Scope</CardTitle>
        </div>
        <CardDescription>
          Choose how sensitive patient PII is handled before this section is published. This data
          crosses into the reports app's separate database.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 max-w-sm">
        <Label htmlFor="pii-scope">Scope</Label>
        <Select value={value} onValueChange={(v) => isPiiScope(v) && onChange(v)}>
          <SelectTrigger id="pii-scope" aria-label="PII scope">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PII_SCOPE_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">{active.hint}</p>
      </CardContent>
    </Card>
  )
}
