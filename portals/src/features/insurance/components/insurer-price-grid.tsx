import { Loader2, Save, Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  getInsurerServicePrices,
  type InsurerServicePrice,
  saveInsurerServicePrices,
} from '@/lib/actions/insurance-pricing'
import { useApiMutation, useApiQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query-keys'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { Input } from '@/shared/components/ui/input'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { centsToInput, formatAmount, inputToCents } from '@/shared/utils/currency'

interface Props {
  companyId: string
  /** Bumped by the parent after a CSV upload so the grid re-reads live prices. */
  refreshToken?: number
  onSaved?: () => void
}

const ghs = (n: number) => `GHS ${formatAmount(n)}`

/**
 * Manual per-service pricing for one insurer.
 *
 * The CSV flow is the bulk path; this is for "they pay 80 for a consultation".
 * Both write `insurance_price_lists` + `insurance_price_list_items`, so whatever
 * is set here resolves at checkout through the same `resolveInsurerPrice()` the
 * uploads use.
 *
 * A blank price means **not covered** — the treatment stays chargeable to the
 * patient at the clinic's own price but can't be billed to this insurer.
 */
export function InsurerPriceGrid({ companyId, refreshToken = 0, onSaved }: Props) {
  const [q, setQ] = useState('')
  // serviceId → raw input text. Seeded from the server on load; edits live here
  // so a half-typed "8" doesn't momentarily read as a price of 8.
  const [draft, setDraft] = useState<Record<string, string>>({})

  const priceListKey = queryKeys.insurance.servicePrices(companyId, refreshToken)
  const pricesQuery = useApiQuery<{ hasEffectiveList: boolean; services: InsurerServicePrice[] }>(
    priceListKey,
    () => getInsurerServicePrices(companyId)
  )
  const rows = pricesQuery.data?.services ?? []
  const loading = pricesQuery.isLoading

  // Re-seed the edit buffer whenever the server data actually changes — a
  // company switch, the CSV-upload sibling bumping `refreshToken`, or this
  // grid's own save. Structural sharing keeps `data` referentially stable
  // across no-op background refetches, so this doesn't clobber in-progress typing.
  useEffect(() => {
    if (!pricesQuery.data) return
    setDraft(
      Object.fromEntries(
        pricesQuery.data.services.map((s) => [
          s.serviceId,
          s.insurerPrice == null ? '' : centsToInput(s.insurerPrice),
        ])
      )
    )
  }, [pricesQuery.data])

  const saveMutation = useApiMutation(
    (prices: Array<{ serviceId: string; price: number }>) =>
      saveInsurerServicePrices(companyId, prices),
    { invalidates: [priceListKey] }
  )
  const saving = saveMutation.isPending

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase()
    if (!term) return rows
    return rows.filter(
      (r) => r.name.toLowerCase().includes(term) || r.category.toLowerCase().includes(term)
    )
  }, [rows, q])

  const coveredCount = useMemo(
    () => Object.values(draft).filter((v) => v.trim() !== '' && Number(v) >= 0).length,
    [draft]
  )

  const isDirty = useMemo(
    () =>
      rows.some((r) => {
        const raw = (draft[r.serviceId] ?? '').trim()
        const currentCents = raw !== '' ? inputToCents(raw) : null
        const savedCents = r.insurerPrice == null ? null : r.insurerPrice
        return currentCents !== savedCents
      }),
    [rows, draft]
  )

  async function onSave() {
    const prices: Array<{ serviceId: string; price: number }> = []
    for (const r of rows) {
      const raw = (draft[r.serviceId] ?? '').trim()
      if (raw === '') continue
      const cents = inputToCents(raw)
      if (cents < 0) {
        toast.error(`"${r.name}" has an invalid price`)
        return
      }
      prices.push({ serviceId: r.serviceId, price: cents })
    }

    try {
      await saveMutation.mutateAsync(prices)
      toast.success(
        prices.length === 0
          ? 'Cleared — no services are billable to this insurer'
          : `Saved — ${prices.length} service${prices.length === 1 ? '' : 's'} billable to this insurer`
      )
      onSaved?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save prices')
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base">Insurer prices</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              What this insurer pays per service. Leave a price blank to mark it not covered — staff
              can still charge the patient the clinic price, it just can&apos;t be claimed.
            </p>
          </div>
          <Button size="sm" onClick={onSave} disabled={saving || loading || !isDirty}>
            {saving ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="mr-1.5 h-3.5 w-3.5" />
            )}
            Save prices
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search service or category…"
              className="pl-8"
            />
          </div>
          <Badge variant="secondary" className="shrink-0">
            {coveredCount} of {rows.length} covered
          </Badge>
        </div>

        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No active services in the catalogue yet — add services first, then price them here.
          </p>
        ) : (
          <div className="max-h-[420px] overflow-y-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted/60 backdrop-blur">
                <tr className="text-left">
                  <th className="px-3 py-2 font-medium">Service</th>
                  <th className="px-3 py-2 font-medium">Category</th>
                  <th className="px-3 py-2 text-right font-medium">Clinic price</th>
                  <th className="px-3 py-2 text-right font-medium">Insurer pays</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => {
                  const raw = (draft[r.serviceId] ?? '').trim()
                  const covered = raw !== ''
                  return (
                    <tr key={r.serviceId} className="border-t">
                      <td className="px-3 py-1.5">{r.name}</td>
                      <td className="px-3 py-1.5 capitalize text-muted-foreground">{r.category}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                        {ghs(r.clinicPrice)}
                      </td>
                      <td className="px-3 py-1.5">
                        <div className="flex items-center justify-end gap-2">
                          {!covered && (
                            <span className="text-xs text-muted-foreground">Not covered</span>
                          )}
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            inputMode="decimal"
                            value={draft[r.serviceId] ?? ''}
                            onChange={(e) =>
                              setDraft((prev) => ({ ...prev, [r.serviceId]: e.target.value }))
                            }
                            placeholder="—"
                            aria-label={`Insurer price for ${r.name}`}
                            className="h-8 w-28 text-right tabular-nums"
                          />
                        </div>
                      </td>
                    </tr>
                  )
                })}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">
                      No services match &ldquo;{q}&rdquo;.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
