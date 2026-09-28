import { useState } from 'react'
import { Document, Page } from 'react-pdf'
import { toast } from 'sonner'
import { createDocInstance, type DocTemplate, signDocument } from '@/lib/actions/documents'
import { Button } from '@/shared/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import { SignaturePad } from '@/shared/components/ui/signature-pad'
import { pointsToPx } from '@/shared/lib/pdf'

const RENDER_WIDTH = 640

/**
 * In-clinic sign UI (admin-v1 CC.4). Renders the template, overlays its fields as
 * inputs (text/date/checkbox) + tap-to-sign signature regions, then creates an
 * instance for the subject and flattens it via the backend engine.
 */
export function DocumentSigner({
  template,
  subjectType,
  subjectId,
  subjectName,
  onDone,
  onCancel,
}: {
  template: DocTemplate
  subjectType: string
  subjectId: string
  subjectName: string
  onDone: () => void
  onCancel: () => void
}) {
  const [numPages, setNumPages] = useState(0)
  const [pageIndex, setPageIndex] = useState(0)
  const [dims, setDims] = useState<Record<number, { w: number; h: number }>>({})
  const [values, setValues] = useState<Record<string, string>>({})
  const [signing, setSigning] = useState<string | null>(null)
  const [pendingSig, setPendingSig] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const orig = dims[pageIndex]
  const scale = orig ? RENDER_WIDTH / orig.w : 1
  const renderedH = orig ? orig.h * scale : 0
  const pageFields = template.fields.filter((f) => f.page === pageIndex)

  async function submit() {
    setBusy(true)
    const inst = await createDocInstance({
      templateId: template.id,
      subjectType,
      subjectId,
      title: template.name,
    })
    if (!inst.success || !inst.data) {
      setBusy(false)
      toast.error(inst.error || 'Could not create document')
      return
    }
    const res = await signDocument(inst.data.id, values, [{ role: 'subject', name: subjectName }])
    setBusy(false)
    if (res.success) {
      toast.success('Document signed')
      onDone()
    } else toast.error(res.error || 'Signing failed')
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="font-medium">{template.name}</p>
        {numPages > 1 && (
          <div className="flex items-center gap-2 text-sm">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pageIndex === 0}
              onClick={() => setPageIndex((p) => p - 1)}
            >
              Prev
            </Button>
            <span>
              {pageIndex + 1} / {numPages}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pageIndex >= numPages - 1}
              onClick={() => setPageIndex((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        )}
      </div>

      <div className="relative inline-block border" style={{ width: RENDER_WIDTH }}>
        <Document file={template.pdfUrl} onLoadSuccess={(pdf) => setNumPages(pdf.numPages)}>
          <Page
            key={pageIndex}
            pageNumber={pageIndex + 1}
            width={RENDER_WIDTH}
            renderTextLayer={false}
            renderAnnotationLayer={false}
            onLoadSuccess={(page: { originalWidth: number; originalHeight: number }) =>
              setDims((d) => ({
                ...d,
                [pageIndex]: { w: page.originalWidth, h: page.originalHeight },
              }))
            }
          />
        </Document>

        <div className="absolute inset-x-0 top-0" style={{ height: renderedH }}>
          {pageFields.map((f) => {
            const box = pointsToPx(f, scale, renderedH)
            const style = {
              left: box.left,
              top: box.top,
              width: box.width,
              height: box.height,
            } as const

            if (f.type === 'signature' || f.type === 'initials') {
              const signed = !!values[f.id]
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => {
                    setSigning(f.id)
                    setPendingSig(values[f.id] ?? null)
                  }}
                  className={`absolute flex items-center justify-center border-2 text-[10px] ${
                    signed
                      ? 'border-emerald-500 bg-emerald-500/10 text-emerald-700'
                      : 'border-amber-500 bg-amber-500/10 text-amber-700'
                  }`}
                  style={style}
                >
                  {signed ? '✓ signed' : 'tap to sign'}
                </button>
              )
            }
            if (f.type === 'checkbox') {
              return (
                <input
                  key={f.id}
                  type="checkbox"
                  checked={values[f.id] === 'true'}
                  onChange={(e) =>
                    setValues((v) => ({ ...v, [f.id]: e.target.checked ? 'true' : '' }))
                  }
                  className="absolute"
                  style={{ left: box.left, top: box.top }}
                />
              )
            }
            return (
              <input
                key={f.id}
                value={values[f.id] ?? ''}
                onChange={(e) => setValues((v) => ({ ...v, [f.id]: e.target.value }))}
                placeholder={f.type}
                className="absolute border border-sky-400 bg-white/90 px-1 text-xs"
                style={style}
              />
            )
          })}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button onClick={submit} disabled={busy}>
          {busy ? 'Signing…' : 'Sign & save'}
        </Button>
        <Button variant="outline" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>

      <Dialog open={!!signing} onOpenChange={(o) => !o && setSigning(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Signature</DialogTitle>
          </DialogHeader>
          <SignaturePad onChange={setPendingSig} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setSigning(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (signing && pendingSig) setValues((v) => ({ ...v, [signing]: pendingSig }))
                setSigning(null)
              }}
              disabled={!pendingSig}
            >
              Apply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
