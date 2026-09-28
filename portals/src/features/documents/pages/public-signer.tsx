import { AlertTriangle, CheckCircle2, Download, FileText, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Document, Page } from 'react-pdf'
import { useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { api } from '@/lib/api-client'
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

interface SignerInfo {
  id: string
  name: string
  email: string
  status: 'PENDING' | 'SIGNED'
  order: number
}

interface InstanceInfo {
  id: string
  title: string
  status: 'draft' | 'sent' | 'partially_signed' | 'completed'
  signingOrder: 'SEQUENTIAL' | 'PARALLEL'
  signedPdfUrl: string | null
}

interface FieldInfo {
  id: string
  type: 'text' | 'name' | 'address' | 'date' | 'signature' | 'initials' | 'checkbox'
  page: number
  x: number
  y: number
  w: number
  h: number
  value: string | null
}

export function PublicSignerPage() {
  const { token } = useParams<{ token: string }>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [signer, setSigner] = useState<SignerInfo | null>(null)
  const [instance, setInstance] = useState<InstanceInfo | null>(null)
  const [fields, setFields] = useState<FieldInfo[]>([])

  const [numPages, setNumPages] = useState(0)
  const [pageIndex, setPageIndex] = useState(0)
  const [dims, setDims] = useState<Record<number, { w: number; h: number }>>({})
  const [values, setValues] = useState<Record<string, string>>({})
  const [signing, setSigning] = useState<string | null>(null)
  const [pendingSig, setPendingSig] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [completed, setCompleted] = useState(false)

  useEffect(() => {
    if (!token) return
    loadContext()
  }, [token, loadContext])

  async function loadContext() {
    setLoading(true)
    setError(null)
    try {
      const res = await api.get<{
        signer: SignerInfo
        instance: InstanceInfo
        fields: FieldInfo[]
      }>(`/api/sign/${token}`, { suppressSessionExpired: true })

      if (res.success && res.data) {
        setSigner(res.data.signer)
        setInstance(res.data.instance)
        setFields(res.data.fields)

        // Initialize values from loaded fields
        const vals: Record<string, string> = {}
        for (const f of res.data.fields) {
          vals[f.id] = f.value ?? ''
        }
        setValues(vals)

        if (res.data.signer.status === 'SIGNED') {
          setCompleted(true)
        }
      } else {
        setError(res.error || 'Failed to verify signing token.')
      }
    } catch (err: any) {
      setError(err.message || 'Verification failed')
    } finally {
      setLoading(false)
    }
  }

  const orig = dims[pageIndex]
  const scale = orig ? RENDER_WIDTH / orig.w : 1
  const renderedH = orig ? orig.h * scale : 0
  const pageFields = fields.filter((f) => f.page === pageIndex)

  async function handleSubmit() {
    // Basic validation: ensure all signature/initial fields are filled
    const missingSignatures = fields.filter(
      (f) => (f.type === 'signature' || f.type === 'initials') && !values[f.id]
    )
    if (missingSignatures.length > 0) {
      toast.error('Please apply your signature to all signature fields before submitting.')
      return
    }

    setBusy(true)
    try {
      const fieldsUpdate = Object.entries(values).map(([id, value]) => ({
        id,
        value,
      }))
      const res = await api.post<any>(
        `/api/sign/${token}`,
        { fields: fieldsUpdate },
        { suppressSessionExpired: true }
      )
      if (res.success) {
        toast.success('Document signed successfully')
        setCompleted(true)
        if (signer) {
          setSigner({ ...signer, status: 'SIGNED' })
        }
        // Reload context to refresh completed document state & signedPdfUrl
        await loadContext()
      } else {
        toast.error(res.error || 'Failed to submit signature')
      }
    } catch (err: any) {
      toast.error(err.message || 'Submission failed')
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 p-4">
        <Loader2 className="h-10 w-10 animate-spin text-sky-500" />
        <p className="mt-4 text-sm text-slate-500">Loading document signing workspace...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 p-4">
        <div className="w-full max-w-md border border-red-200 bg-background p-6 shadow-lg rounded-xl">
          <div className="flex flex-col items-center text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-red-600">
              <AlertTriangle className="h-6 w-6" />
            </div>
            <h3 className="mt-4 text-lg font-semibold text-slate-900">Access Denied</h3>
            <p className="mt-2 text-sm text-slate-600">{error}</p>
            <p className="mt-1 text-xs text-slate-500">
              This link may have expired or you may have already completed your signing steps.
            </p>
          </div>
        </div>
      </div>
    )
  }

  if (completed) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 p-4">
        <div className="w-full max-w-md border border-emerald-100 bg-background p-6 shadow-lg rounded-xl">
          <div className="flex flex-col items-center text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
              <CheckCircle2 className="h-6 w-6" />
            </div>
            <h3 className="mt-4 text-lg font-semibold text-slate-900">Signature Completed</h3>
            <p className="mt-2 text-sm text-slate-600">
              Thank you, <strong>{signer?.name}</strong>. You have successfully signed this
              document.
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {instance?.status === 'completed'
                ? 'The document has been fully executed by all signers.'
                : 'The document is awaiting signatures from other signers.'}
            </p>
            {instance?.status === 'completed' && instance.signedPdfUrl && (
              <a
                href={instance.signedPdfUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-6 inline-flex items-center gap-2 rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-sky-600"
              >
                <Download className="h-4 w-4" /> Download Signed PDF
              </a>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-100 pb-12">
      {/* Top Header */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-200 bg-background px-6 py-4 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-sky-100 p-2 text-sky-600">
            <FileText className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-slate-900">{instance?.title}</h1>
            <p className="text-xs text-slate-500">
              Signing as <span className="font-semibold text-slate-700">{signer?.name}</span> (
              {signer?.email})
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4">
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
              <span className="text-xs font-medium text-slate-600">
                Page {pageIndex + 1} of {numPages}
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
          <Button onClick={handleSubmit} disabled={busy || completed}>
            {busy ? 'Submitting…' : 'Submit Signature'}
          </Button>
        </div>
      </header>

      {/* Main Document Body */}
      <main className="mt-8 flex justify-center px-4">
        <div
          className="relative inline-block bg-background shadow-xl border border-slate-200 rounded-lg overflow-hidden"
          style={{ width: RENDER_WIDTH }}
        >
          <Document
            file={instance?.signedPdfUrl || undefined}
            onLoadSuccess={(pdf) => setNumPages(pdf.numPages)}
            loading={
              <div className="flex h-96 items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
              </div>
            }
          >
            <Page
              key={pageIndex}
              pageNumber={pageIndex + 1}
              width={RENDER_WIDTH}
              renderTextLayer={false}
              renderAnnotationLayer={false}
              onLoadSuccess={(page: any) =>
                setDims((d) => ({
                  ...d,
                  [pageIndex]: { w: page.originalWidth, h: page.originalHeight },
                }))
              }
            />
          </Document>

          {/* Interactive Overlaid Fields */}
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
                    className={`absolute flex items-center justify-center border-2 text-[10px] rounded cursor-pointer transition-colors ${
                      signed
                        ? 'border-emerald-500 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/25'
                        : 'border-amber-500 bg-amber-500/10 text-amber-700 hover:bg-amber-500/25'
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
                    className="absolute cursor-pointer"
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
                  className="absolute border border-sky-400 bg-white/90 px-1 text-xs focus:border-sky-600 focus:outline-none rounded"
                  style={style}
                />
              )
            })}
          </div>
        </div>
      </main>

      {/* Signature Dialog */}
      <Dialog open={!!signing} onOpenChange={(o) => !o && setSigning(null)}>
        <DialogContent className="max-w-md bg-background">
          <DialogHeader>
            <DialogTitle>Draw Signature</DialogTitle>
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
              Apply Signature
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
