import { Download, Loader2, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  downloadServicesCsv,
  importServicesCsv,
  type ServiceCsvPreview,
} from '@/lib/actions/services'
import { Button } from '@/shared/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import { formatAmount } from '@/shared/utils/currency'

/**
 * Base-catalog CSV controls (P1): Export a category's current services as a CSV
 * template, then re-upload to bulk-update prices (matched by service_id) and add
 * new rows (blank service_id). Upload always previews before committing.
 */
export function ServiceCsvControls({
  category,
  label,
  onImported,
}: {
  category: string
  label: string
  onImported: () => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [exporting, setExporting] = useState(false)
  const [open, setOpen] = useState(false)
  const [csv, setCsv] = useState('')
  const [fileName, setFileName] = useState('')
  const [preview, setPreview] = useState<ServiceCsvPreview | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleExport() {
    setExporting(true)
    const res = await downloadServicesCsv(category)
    setExporting(false)
    if (!res.success) toast.error(res.error ?? 'Export failed')
  }

  async function onFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-picking the same file
    if (!file) return
    const text = await file.text()
    setCsv(text)
    setFileName(file.name)
    setPreview(null)
    setOpen(true)
    // Immediately fetch a dry-run preview.
    setLoading(true)
    const res = await importServicesCsv(category, text, false)
    setLoading(false)
    if (!res.success || !res.data) {
      toast.error(res.error ?? 'Could not read CSV')
      setOpen(false)
      return
    }
    setPreview(res.data)
  }

  async function handleApply() {
    if (!csv) return
    setLoading(true)
    const res = await importServicesCsv(category, csv, true)
    setLoading(false)
    if (!res.success || !res.data) {
      toast.error(res.error ?? 'Import failed')
      return
    }
    toast.success(`Imported — ${res.data.updated ?? 0} updated, ${res.data.created ?? 0} added`)
    setOpen(false)
    setCsv('')
    setPreview(null)
    onImported()
  }

  const hasErrors = (preview?.errors.length ?? 0) > 0
  const nothingToDo =
    preview && preview.toUpdate.length === 0 && preview.toCreate.length === 0 && !hasErrors

  return (
    <>
      <Button variant="outline" onClick={handleExport} disabled={exporting}>
        {exporting ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <Download className="mr-2 h-4 w-4" />
        )}
        Export CSV
      </Button>
      <Button variant="outline" onClick={() => fileRef.current?.click()}>
        <Upload className="mr-2 h-4 w-4" />
        Import CSV
      </Button>
      <input
        ref={fileRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={onFilePicked}
      />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Import {label} services</DialogTitle>
            <DialogDescription>
              Review changes from <span className="font-medium">{fileName}</span> before applying.
              Rows with a <code>service_id</code> update that service; blank <code>service_id</code>{' '}
              adds a new one.
            </DialogDescription>
          </DialogHeader>

          {loading && !preview ? (
            <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Reading CSV…
            </div>
          ) : preview ? (
            <div className="space-y-3 text-sm">
              <div className="flex gap-4">
                <div className="rounded-md border px-3 py-2">
                  <div className="text-lg font-semibold">{preview.toUpdate.length}</div>
                  <div className="text-xs text-muted-foreground">to update</div>
                </div>
                <div className="rounded-md border px-3 py-2">
                  <div className="text-lg font-semibold">{preview.toCreate.length}</div>
                  <div className="text-xs text-muted-foreground">to add</div>
                </div>
                <div className="rounded-md border px-3 py-2">
                  <div className={`text-lg font-semibold ${hasErrors ? 'text-destructive' : ''}`}>
                    {preview.errors.length}
                  </div>
                  <div className="text-xs text-muted-foreground">errors</div>
                </div>
              </div>

              {hasErrors && (
                <div className="max-h-32 overflow-y-auto rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
                  {preview.errors.slice(0, 20).map((err) => (
                    <div key={err}>{err}</div>
                  ))}
                  {preview.errors.length > 20 && <div>…and {preview.errors.length - 20} more</div>}
                </div>
              )}

              {preview.toUpdate.length > 0 && (
                <div className="max-h-40 overflow-y-auto rounded-md border p-2 text-xs">
                  {preview.toUpdate.slice(0, 30).map((u) => (
                    <div key={u.id} className="flex justify-between gap-2">
                      <span className="truncate">{u.name}</span>
                      <span className="tabular-nums text-muted-foreground">
                        {u.was != null ? formatAmount(u.was) : '—'} →{' '}
                        <span className="text-foreground">{formatAmount(u.amount)}</span>
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {nothingToDo && (
                <p className="text-muted-foreground">No changes detected in this file.</p>
              )}
            </div>
          ) : null}

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={loading}>
              Cancel
            </Button>
            <Button
              onClick={handleApply}
              disabled={loading || hasErrors || !preview || !!nothingToDo}
            >
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Apply changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
