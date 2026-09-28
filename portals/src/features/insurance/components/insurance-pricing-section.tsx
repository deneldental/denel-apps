import { format } from 'date-fns'
import { CheckCircle2, Download, FileSpreadsheet, Loader2, Trash2, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  deleteInsurerPriceList,
  downloadInsurerTemplate,
  getInsurerPriceList,
  getInsurerPriceLists,
  type InsurerPriceList,
  type InsurerPriceListItem,
  setInsurerPriceListEffective,
  uploadInsurerPriceList,
} from '@/lib/actions/insurance-pricing'
import { useApiMutation, useApiQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query-keys'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { DeleteConfirmationDialog } from '@/shared/components/ui/delete-confirmation-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import { formatAmount } from '@/shared/utils/currency'

const fmtDate = (s: string) => {
  try {
    return format(new Date(s), 'MMM d, yyyy')
  } catch {
    return s
  }
}
const ghs = (n: number) => `GHS ${formatAmount(Number(n))}`

const STATUS_BADGE: Record<
  InsurerPriceList['status'],
  { label: string; variant: 'default' | 'secondary' | 'outline' }
> = {
  effective: { label: 'Effective', variant: 'default' },
  draft: { label: 'Draft', variant: 'secondary' },
  archived: { label: 'Archived', variant: 'outline' },
}

/**
 * CSV-based insurer pricing (P2). Upload a price list built from our services;
 * rows auto-map to our catalog, and unmatched rows go to Approvals. Making a
 * list "Effective" makes its approved rows the insurer's live, billable prices.
 */
export function InsurancePricingSection({
  companyId,
  onPricingChanged,
}: {
  companyId: string
  /** Fires whenever an upload, delete, or set-effective changes which prices
   *  are live, so a sibling view of the same data can refetch. */
  onPricingChanged?: () => void
}) {
  const [busyId, setBusyId] = useState<string | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [viewItems, setViewItems] = useState<InsurerPriceListItem[] | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const PRICE_LISTS_KEY = queryKeys.insurance.priceLists(companyId)
  const listsQuery = useApiQuery<InsurerPriceList[]>(PRICE_LISTS_KEY, () =>
    getInsurerPriceLists(companyId)
  )
  const lists = listsQuery.data ?? []
  const loading = listsQuery.isLoading

  const uploadMutation = useApiMutation(
    (vars: { fileName: string; text: string }) =>
      uploadInsurerPriceList(companyId, vars.fileName, vars.text),
    { invalidates: [PRICE_LISTS_KEY] }
  )
  const setEffectiveMutation = useApiMutation((id: string) => setInsurerPriceListEffective(id), {
    invalidates: [PRICE_LISTS_KEY],
  })
  const deleteMutation = useApiMutation((id: string) => deleteInsurerPriceList(id), {
    invalidates: [PRICE_LISTS_KEY],
  })
  const uploading = uploadMutation.isPending
  const [downloading, setDownloading] = useState(false)

  async function handleTemplate() {
    setDownloading(true)
    const res = await downloadInsurerTemplate(companyId)
    setDownloading(false)
    if (!res.success) toast.error(res.error ?? 'Template download failed')
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const text = await file.text()
    try {
      const { approved, pending } = await uploadMutation.mutateAsync({
        fileName: file.name,
        text,
      })
      toast.success(
        `Uploaded — ${approved} matched${pending > 0 ? `, ${pending} need approval` : ''}`
      )
      onPricingChanged?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed')
    }
  }

  async function handleSetEffective(id: string) {
    setBusyId(id)
    try {
      await setEffectiveMutation.mutateAsync(id)
      toast.success('This price list is now effective')
      onPricingChanged?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to set effective')
    } finally {
      setBusyId(null)
    }
  }

  async function handleView(id: string) {
    const res = await getInsurerPriceList(id)
    if (res.success && res.data) setViewItems(res.data.items)
    else toast.error('Failed to load items')
  }

  async function handleDelete() {
    if (!deleteId) return
    const id = deleteId
    setDeleteId(null)
    try {
      await deleteMutation.mutateAsync(id)
      toast.success('Price list deleted')
      onPricingChanged?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Delete failed')
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-medium">
          <FileSpreadsheet className="h-4 w-4" />
          Pricing (CSV)
        </h3>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={handleTemplate} disabled={downloading}>
            {downloading ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="mr-1.5 h-3.5 w-3.5" />
            )}
            Template
          </Button>
          <Button size="sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
            {uploading ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Upload className="mr-1.5 h-3.5 w-3.5" />
            )}
            Upload CSV
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={onFile}
          />
        </div>
      </div>

      {loading ? (
        <div className="py-6 text-center text-sm text-muted-foreground">Loading price lists…</div>
      ) : lists.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-8 text-center">
          <p className="text-sm text-muted-foreground">
            No pricing uploaded. Download the template, fill in the insurer's prices, and upload it.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-border rounded-lg border border-border">
          {lists.map((l) => {
            const badge = STATUS_BADGE[l.status]
            return (
              <div key={l.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{l.fileName}</span>
                    <Badge variant={badge.variant} className="text-[10px]">
                      {badge.label}
                    </Badge>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {l.rowCount} rows · {l.approved} matched
                    {l.pending > 0 && (
                      <span className="text-amber-600"> · {l.pending} need approval</span>
                    )}{' '}
                    · {fmtDate(l.uploadedAt)}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <Button size="sm" variant="ghost" onClick={() => handleView(l.id)}>
                    View
                  </Button>
                  {l.status !== 'effective' && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleSetEffective(l.id)}
                      disabled={busyId === l.id}
                    >
                      {busyId === l.id ? (
                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                      )}
                      Set effective
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive"
                    onClick={() => setDeleteId(l.id)}
                    aria-label="Delete price list"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Items viewer */}
      <Dialog open={viewItems !== null} onOpenChange={(o) => !o && setViewItems(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Price list rows</DialogTitle>
            <DialogDescription>
              Insurer service → our service, with the negotiated price. Rows marked "needs approval"
              aren't billable until an admin links them in Approvals.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">Insurer name</th>
                  <th className="px-3 py-2 text-left">Our service</th>
                  <th className="px-3 py-2 text-right">Price</th>
                  <th className="px-3 py-2 text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                {(viewItems ?? []).map((it) => (
                  <tr key={it.id} className="border-t">
                    <td className="px-3 py-2">
                      {it.insurerName}
                      {it.insurerCode && (
                        <span className="ml-1 text-xs text-muted-foreground">
                          ({it.insurerCode})
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {it.ourServiceName ?? <span className="italic text-amber-600">unmapped</span>}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{ghs(it.price)}</td>
                    <td className="px-3 py-2">
                      {it.mappingStatus === 'approved' ? (
                        <Badge variant="default" className="text-[10px]">
                          Matched
                        </Badge>
                      ) : it.mappingStatus === 'rejected' ? (
                        <Badge variant="outline" className="text-[10px]">
                          Rejected
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="text-[10px] text-amber-700">
                          Needs approval
                        </Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DialogContent>
      </Dialog>

      <DeleteConfirmationDialog
        open={deleteId !== null}
        onOpenChange={(o) => !o && setDeleteId(null)}
        onConfirm={handleDelete}
        title="Delete price list?"
        description="This removes the uploaded pricing and its rows. If it was effective, the insurer will have no live prices until you make another list effective."
      />
    </div>
  )
}
