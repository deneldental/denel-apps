import { Trash2 } from 'lucide-react'
import { type PointerEvent as ReactPointerEvent, useId, useRef, useState } from 'react'
import { Document, Page } from 'react-pdf'
import { toast } from 'sonner'
import type { TemplateField } from '@/lib/actions/documents'
import { Button } from '@/shared/components/ui/button'
import { type PxRect, pointsToPx, pxToPoints } from '@/shared/lib/pdf'

const RENDER_WIDTH = 640
const FIELD_TYPES: TemplateField['type'][] = [
  'text',
  'name',
  'address',
  'date',
  'signature',
  'initials',
  'checkbox',
]

/**
 * Visual template editor (admin-v1 CC.4). Renders the template PDF and lets the
 * admin drag to place typed field regions; positions are stored in PDF points so
 * the backend pdf-lib engine draws them exactly where they were placed.
 */
export function PdfFieldEditor({
  pdfUrl,
  initialFields,
  onSave,
  saving,
}: {
  pdfUrl: string
  initialFields: TemplateField[]
  onSave: (fields: TemplateField[]) => void
  saving?: boolean
}) {
  const [numPages, setNumPages] = useState(0)
  const [pageIndex, setPageIndex] = useState(0)
  const [dims, setDims] = useState<Record<number, { w: number; h: number }>>({})
  const [fields, setFields] = useState<TemplateField[]>(initialFields)
  const [draft, setDraft] = useState<PxRect | null>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const start = useRef<{ x: number; y: number } | null>(null)
  const idBase = useId()

  const orig = dims[pageIndex]
  const scale = orig ? RENDER_WIDTH / orig.w : 1
  const renderedH = orig ? orig.h * scale : 0

  function relPos(e: ReactPointerEvent) {
    const r = overlayRef.current?.getBoundingClientRect()
    if (!r) return { x: 0, y: 0 }
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }
  function onDown(e: ReactPointerEvent) {
    const p = relPos(e)
    start.current = p
    setDraft({ x: p.x, y: p.y, w: 0, h: 0 })
    overlayRef.current?.setPointerCapture(e.pointerId)
  }
  function onMove(e: ReactPointerEvent) {
    const s = start.current
    if (!s) return
    const p = relPos(e)
    setDraft({
      x: Math.min(s.x, p.x),
      y: Math.min(s.y, p.y),
      w: Math.abs(p.x - s.x),
      h: Math.abs(p.y - s.y),
    })
  }
  function onUp() {
    if (draft && draft.w > 8 && draft.h > 6 && orig) {
      const pts = pxToPoints(draft, scale, renderedH)
      setFields((f) => [
        ...f,
        { id: `${idBase}-${f.length}`, page: pageIndex, ...pts, type: 'text' },
      ])
    }
    start.current = null
    setDraft(null)
  }

  const setType = (id: string, type: TemplateField['type']) =>
    setFields((f) => f.map((x) => (x.id === id ? { ...x, type } : x)))
  const remove = (id: string) => setFields((f) => f.filter((x) => x.id !== id))

  const pageFields = fields.filter((f) => f.page === pageIndex)

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Drag on the page to place a field, then set its type. Positions are saved in PDF
        coordinates.
      </p>

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
            Page {pageIndex + 1} / {numPages}
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

      <div className="relative inline-block border" style={{ width: RENDER_WIDTH }}>
        <Document file={pdfUrl} onLoadSuccess={(pdf) => setNumPages(pdf.numPages)}>
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

        {/* biome-ignore lint/a11y/noStaticElementInteractions: drawing surface */}
        <div
          ref={overlayRef}
          className="absolute inset-x-0 top-0 cursor-crosshair"
          style={{ height: renderedH }}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
        >
          {pageFields.map((f) => {
            const box = pointsToPx(f, scale, renderedH)
            return (
              <div
                key={f.id}
                className="absolute border-2 border-sky-500 bg-sky-500/10"
                style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <div className="-top-7 absolute left-0 flex items-center gap-1 rounded bg-slate-900 px-1 py-0.5 text-white">
                  <select
                    value={f.type}
                    onChange={(e) => setType(f.id, e.target.value as TemplateField['type'])}
                    className="bg-slate-900 text-[11px]"
                  >
                    {FIELD_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                  <button type="button" onClick={() => remove(f.id)} aria-label="Delete field">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            )
          })}
          {draft && (
            <div
              className="absolute border-2 border-sky-400 border-dashed bg-sky-400/10"
              style={{ left: draft.x, top: draft.y, width: draft.w, height: draft.h }}
            />
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button
          onClick={() => {
            onSave(fields)
            toast.success(`${fields.length} field(s) saved`)
          }}
          disabled={saving}
        >
          {saving ? 'Saving…' : 'Save fields'}
        </Button>
        <span className="text-sm text-muted-foreground">{fields.length} field(s)</span>
      </div>
    </div>
  )
}
