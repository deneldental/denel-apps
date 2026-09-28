import { format } from 'date-fns'
import { Download, Lock, ShieldCheck } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { api } from '@/lib/api-client'
import { useBranding } from '@/lib/branding-context'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent } from '@/shared/components/ui/card'
import { Input } from '@/shared/components/ui/input'

type LinkStatus = 'loading' | 'valid' | 'expired' | 'revoked' | 'not_found'

type LinkMeta = {
  recipientName: string
  firstName: string
  expiresAt: string
  requiresCode: boolean
}

type XrayRecord = {
  id: string
  imageUrl: string | null
  thumbnailUrl: string | null
  capturedAt: string | null
  notes: string | null
  toothNumber: number | null
}

const MAX_ATTEMPTS = 5

export default function XrayPublicViewerPage() {
  const branding = useBranding()
  const { token = '' } = useParams<{ token: string }>()

  const [status, setStatus] = useState<LinkStatus>('loading')
  const [meta, setMeta] = useState<LinkMeta | null>(null)
  const [records, setRecords] = useState<XrayRecord[] | null>(null)
  const [otpInput, setOtpInput] = useState('')
  const [attempts, setAttempts] = useState(0)

  useEffect(() => {
    if (!token) {
      setStatus('not_found')
      return
    }
    void api.get<LinkMeta>(`/api/xrays/public/share/${token}`).then((res) => {
      if (!res.success) {
        const msg = (res.error ?? '').toLowerCase()
        if (msg.includes('revok')) setStatus('revoked')
        else if (msg.includes('expir')) setStatus('expired')
        else setStatus('not_found')
        return
      }
      setMeta(res.data!)
      setStatus('valid')
    })
  }, [token])

  async function handleSubmitOtp(e: React.FormEvent) {
    e.preventDefault()
    if (attempts >= MAX_ATTEMPTS) {
      toast.error('Too many failed attempts. Try again later.')
      return
    }
    const res = await api.post<XrayRecord[]>(`/api/xrays/public/share/${token}/verify`, {
      code: otpInput,
    })
    if (!res.success) {
      const next = attempts + 1
      setAttempts(next)
      toast.error(`Invalid PIN (${next} / ${MAX_ATTEMPTS})`)
      if (next >= MAX_ATTEMPTS) toast.error('Too many failed attempts. Please contact the clinic.')
      return
    }
    setRecords(res.data ?? [])
    toast.success('Access granted')
  }

  if (status === 'loading') {
    return (
      <GateShell brandingName={branding.name}>
        <p className="text-center text-sm text-muted-foreground">Loading…</p>
      </GateShell>
    )
  }

  if (status !== 'valid') {
    const msg =
      status === 'expired'
        ? 'This link has expired.'
        : status === 'revoked'
          ? 'Access to this link has been revoked.'
          : 'This link is not valid.'
    return (
      <GateShell brandingName={branding.name}>
        <div className="space-y-2 text-center">
          <p className="text-lg font-semibold">{msg}</p>
          <p className="text-sm text-muted-foreground">
            Please contact the clinic for a new share link.
          </p>
        </div>
      </GateShell>
    )
  }

  if (!records) {
    const locked = attempts >= MAX_ATTEMPTS
    return (
      <GateShell brandingName={branding.name}>
        <form onSubmit={handleSubmitOtp} className="space-y-4">
          <div className="space-y-1 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <Lock className="h-5 w-5" />
            </div>
            <h1 className="mt-3 text-lg font-semibold">Secure X-ray view</h1>
            <p className="text-sm text-muted-foreground">
              Enter the 6-digit PIN you received to view this X-ray.
            </p>
          </div>
          <div className="space-y-2">
            <Input
              type="text"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              value={otpInput}
              onChange={(e) => setOtpInput(e.target.value.replace(/\D/g, ''))}
              className="text-center font-mono text-xl tracking-[0.5em]"
              placeholder="000000"
              disabled={locked}
              autoFocus
            />
            <p className="text-center text-xs text-muted-foreground">
              {locked
                ? 'Too many failed attempts. Please contact the clinic.'
                : `${MAX_ATTEMPTS - attempts} attempt${MAX_ATTEMPTS - attempts === 1 ? '' : 's'} remaining`}
            </p>
          </div>
          <Button type="submit" className="w-full" disabled={locked || otpInput.length < 6}>
            Unlock
          </Button>
        </form>
      </GateShell>
    )
  }

  return <UnlockedViewer records={records} meta={meta!} brandingName={branding.name} />
}

// ─── Gate shell ──────────────────────────────────────────────────────────────

function GateShell({
  brandingName,
  children,
}: {
  brandingName: string
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-screen flex-col bg-muted/30">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-3xl items-center gap-2 px-6 py-4">
          <ShieldCheck className="h-5 w-5 text-primary" />
          <span className="font-semibold">{brandingName}</span>
        </div>
      </header>
      <main className="flex flex-1 items-center justify-center p-6">
        <Card className="w-full max-w-md">
          <CardContent className="p-6">{children}</CardContent>
        </Card>
      </main>
      <footer className="py-4 text-center text-xs text-muted-foreground">
        Secure document sharing • Confidential
      </footer>
    </div>
  )
}

// ─── Unlocked viewer with watermark compositing ─────────────────────────────

function UnlockedViewer({
  records,
  meta,
  brandingName,
}: {
  records: XrayRecord[]
  meta: LinkMeta
  brandingName: string
}) {
  const [downloading, setDownloading] = useState(false)

  function makeWatermark(r: XrayRecord) {
    const date = r.capturedAt ? format(new Date(r.capturedAt), 'MMM d, yyyy') : ''
    return `${meta.firstName} • ${date} • ${brandingName} — CONFIDENTIAL`
  }

  async function handleDownload(url: string, filename: string, watermark: string) {
    setDownloading(true)
    try {
      await compositeAndDownload(url, watermark, filename)
      toast.success('Download started')
    } catch {
      toast.error('Download failed — please try again')
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-muted/30">
      <header className="sticky top-0 z-10 border-b bg-background">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            <span className="font-semibold">{brandingName}</span>
          </div>
          <div className="text-right text-xs text-muted-foreground">
            <p>Shared with: {meta.recipientName}</p>
            <p>Expires: {format(new Date(meta.expiresAt), 'MMM d, yyyy')}</p>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 space-y-4 p-6">
        <p className="text-center text-xs text-muted-foreground">
          Viewing as: <span className="font-medium text-foreground">{meta.firstName}</span> •
          Downloads carry a confidentiality watermark.
        </p>

        {records.length === 0 ? (
          <p className="py-16 text-center text-sm text-muted-foreground">No images found.</p>
        ) : (
          <div className="space-y-4">
            {records.map((r, i) => {
              const url = r.imageUrl
              if (!url) return null
              const watermark = makeWatermark(r)
              return (
                <Card key={r.id}>
                  <CardContent className="p-4">
                    <div className="relative overflow-hidden rounded-lg border border-border bg-black/5">
                      <img
                        src={url}
                        alt={`X-ray image ${i + 1}${r.toothNumber ? ` (tooth #${r.toothNumber})` : ''}`}
                        className="h-auto max-h-[70vh] w-full object-contain"
                      />
                      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                        <span className="rotate-[-20deg] text-2xl font-black tracking-widest text-white/40">
                          CONFIDENTIAL
                        </span>
                      </div>
                      <div className="pointer-events-none absolute bottom-2 right-2 rounded bg-black/60 px-2 py-1 text-[10px] text-white">
                        {watermark}
                      </div>
                    </div>
                    {r.notes && <p className="mt-2 text-xs text-muted-foreground">{r.notes}</p>}
                    <div className="mt-3 flex justify-end">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleDownload(url, `xray-${r.id}.png`, watermark)}
                        disabled={downloading}
                      >
                        <Download className="mr-1.5 h-3.5 w-3.5" />
                        Download (watermarked)
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        )}
      </main>

      <footer className="py-4 text-center text-xs text-muted-foreground">
        This page is confidential. Do not forward.
      </footer>
    </div>
  )
}

// ─── Watermark + download helper ────────────────────────────────────────────

async function compositeAndDownload(
  srcUrl: string,
  watermark: string,
  filename: string
): Promise<void> {
  const img = new Image()
  img.crossOrigin = 'anonymous'
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('image-load-failed'))
    img.src = srcUrl
  })

  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth || 1200
  canvas.height = img.naturalHeight || 800
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('no-canvas-context')

  ctx.drawImage(img, 0, 0)

  ctx.save()
  ctx.translate(canvas.width / 2, canvas.height / 2)
  ctx.rotate(-Math.PI / 9)
  ctx.font = `bold ${Math.floor(canvas.width / 18)}px sans-serif`
  ctx.fillStyle = 'rgba(255,255,255,0.35)'
  ctx.textAlign = 'center'
  ctx.fillText('CONFIDENTIAL', 0, 0)
  ctx.restore()

  ctx.save()
  ctx.font = `${Math.max(12, Math.floor(canvas.width / 80))}px sans-serif`
  const padding = Math.floor(canvas.width / 60)
  const textMetrics = ctx.measureText(watermark)
  const boxWidth = textMetrics.width + padding * 2
  const boxHeight = Math.floor(canvas.width / 48)
  ctx.fillStyle = 'rgba(0,0,0,0.75)'
  ctx.fillRect(
    canvas.width - boxWidth - padding,
    canvas.height - boxHeight - padding,
    boxWidth,
    boxHeight
  )
  ctx.fillStyle = '#ffffff'
  ctx.textBaseline = 'middle'
  ctx.fillText(
    watermark,
    canvas.width - boxWidth - padding + padding,
    canvas.height - boxHeight / 2 - padding
  )
  ctx.restore()

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), 'image/png')
  )
  if (!blob) throw new Error('canvas-blob-failed')

  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
