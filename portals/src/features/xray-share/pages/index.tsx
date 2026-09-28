import { AlertCircle, Download, ScanLine, ShieldCheck, Wallet } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useToothNotation } from '@/features/clinical/use-clinical-preferences'
import { useBranding } from '@/lib/branding-context'
import { Button } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { Skeleton } from '@/shared/components/ui/skeleton'

const API_URL = import.meta.env.VITE_API_URL

type LinkInfo = {
  recipientName: string
  firstName: string
  expiresAt: string
  requiresCode: boolean
}

type XrayPayload = {
  id: string
  imageUrl: string
  thumbnailUrl: string | null
  origin: 'internal' | 'external'
  toothNumber: number | null
  capturedAt: string | null
  notes: string | null
}

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'code'; info: LinkInfo }
  | { kind: 'verifying' }
  | { kind: 'invalid-code'; info: LinkInfo }
  | { kind: 'viewing'; xrays: XrayPayload[] }

export default function XrayShareViewPage() {
  const { toothLabel } = useToothNotation()
  const branding = useBranding()
  const { token } = useParams<{ token: string }>()
  const [state, setState] = useState<State>({ kind: 'loading' })
  const [code, setCode] = useState('')

  useEffect(() => {
    if (!token) {
      setState({ kind: 'error', message: 'Invalid link.' })
      return
    }
    fetch(`${API_URL}/api/xrays/public/share/${token}`)
      .then(async (r) => {
        const json = await r.json()
        if (!r.ok || !json.success) {
          setState({ kind: 'error', message: json.error || 'Link not available.' })
          return
        }
        setState({ kind: 'code', info: json.data })
      })
      .catch(() => setState({ kind: 'error', message: 'Network error.' }))
  }, [token])

  async function verify() {
    if (!token || !code.trim()) return
    setState({ kind: 'verifying' })
    const res = await fetch(`${API_URL}/api/xrays/public/share/${token}/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: code.trim() }),
    })
    const json = await res.json()
    if (!res.ok || !json.success) {
      setState({
        kind: 'invalid-code',
        info: (state as any).info ?? {
          recipientName: '',
          firstName: '',
          expiresAt: '',
          requiresCode: true,
        },
      })
      return
    }
    setState({ kind: 'viewing', xrays: json.data })
  }

  return (
    <div className="min-h-screen bg-muted/20 px-4 py-10">
      <div className="max-w-3xl mx-auto">
        {/* Brand */}
        <div className="flex items-center gap-2 justify-center mb-6">
          <Wallet className="h-6 w-6" />
          <span className="font-semibold">{branding.name}</span>
        </div>

        {state.kind === 'loading' && <Skeleton className="h-48 w-full rounded-2xl" />}

        {state.kind === 'error' && (
          <div className="rounded-2xl bg-card border border-border p-8 text-center">
            <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive mb-3">
              <AlertCircle className="h-6 w-6" />
            </div>
            <h1 className="text-xl font-semibold mb-1">Link unavailable</h1>
            <p className="text-sm text-muted-foreground">{state.message}</p>
          </div>
        )}

        {(state.kind === 'code' || state.kind === 'verifying' || state.kind === 'invalid-code') &&
          (() => {
            const info = state.kind === 'verifying' ? null : state.info
            return (
              <div className="rounded-2xl bg-card border border-border p-6 sm:p-8">
                <div className="text-center space-y-2 mb-5">
                  <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <ShieldCheck className="h-6 w-6" />
                  </div>
                  <h1 className="text-xl font-semibold">Verify access</h1>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    You're viewing X-rays shared for patient{' '}
                    <strong className="text-foreground">{info?.firstName || ''}</strong>. Enter the
                    6-digit code sent to you on WhatsApp to continue.
                  </p>
                </div>

                <div className="space-y-3">
                  <Input
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="6-digit code"
                    className="text-center text-2xl tracking-widest font-mono h-14"
                    maxLength={6}
                    disabled={state.kind === 'verifying'}
                  />
                  {state.kind === 'invalid-code' && (
                    <p className="text-xs text-destructive text-center">
                      Incorrect code. Try again.
                    </p>
                  )}
                  <Button
                    onClick={verify}
                    disabled={code.length !== 6 || state.kind === 'verifying'}
                    className="w-full"
                  >
                    {state.kind === 'verifying' ? 'Verifying…' : 'View X-rays'}
                  </Button>
                </div>

                <p className="text-[10px] text-muted-foreground text-center mt-5">
                  All access is logged. The link expires on{' '}
                  {info ? new Date(info.expiresAt).toLocaleDateString() : ''}.
                </p>
              </div>
            )
          })()}

        {state.kind === 'viewing' && (
          <div className="space-y-4">
            <div className="rounded-2xl bg-card border border-border p-4">
              <div className="flex items-center gap-2">
                <ScanLine className="h-5 w-5 text-primary" />
                <h2 className="font-semibold">{state.xrays.length} X-ray(s) available</h2>
              </div>
            </div>

            {state.xrays.map((x) => (
              <div key={x.id} className="rounded-2xl bg-card border border-border overflow-hidden">
                <div className="bg-black">
                  <img
                    src={x.imageUrl}
                    alt="X-ray"
                    className="w-full max-h-[80vh] object-contain"
                  />
                </div>
                <div className="p-4 flex items-center justify-between gap-3">
                  <div className="text-xs text-muted-foreground">
                    {x.toothNumber != null && <>Tooth #{toothLabel(x.toothNumber)}</>}
                    {x.origin === 'external' && ' · External source'}
                    {x.notes && ` · ${x.notes}`}
                  </div>
                  <a
                    href={x.imageUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    download
                    className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Download
                  </a>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
