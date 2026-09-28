import logoGold from '@denel/assets/logo-gold.png'
import { Camera, ClipboardList, Delete, Lock, PenLine, Search, ShieldCheck, X } from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  captureKioskXray,
  getKioskConsentTemplates,
  getKioskMe,
  getKioskXrayTypes,
  type KioskConsentTemplate,
  type KioskMe,
  type KioskPatient,
  type KioskSession,
  lockKiosk,
  openKioskSession,
  pairKiosk,
  searchKioskConsentPatients,
  searchKioskPatients,
  signKioskConsent,
  uploadKioskXrayImage,
} from '@/lib/actions/kiosk'
import { api } from '@/lib/api-client'
import { useBranding } from '@/lib/branding-context'
import { useApiQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query-keys'
import { cn } from '@/lib/utils'
import { Button } from '@/shared/components/ui/button'
import { Card as BaseCard } from '@/shared/components/ui/card'
import { Input } from '@/shared/components/ui/input'
import { SignaturePad } from '@/shared/components/ui/signature-pad'
import { resolvePanelSlides } from '@/shared/lib/brand-panel'

type Phase = 'loading' | 'unpaired' | 'locked' | 'unlocked'
const DEFAULT_IDLE_LOCK_MS = 90_000

// ── Auth-styled Kiosk Stage & Cards ──────────────────────────────────────────

/**
 * Full-screen kiosk ground.
 *
 * The same navy-duotone photo treatment as the portal auth screens
 * (`.auth-panel` in `globals.css`), so a paired station matches the sign-in it
 * sits beside. Photos cross-fade only while the station is idle — pairing or
 * locked. On the working screens a single frame holds: movement behind a
 * consent form or a camera capture is a distraction, not decoration.
 */
function Stage({
  children,
  wide,
  still,
}: {
  children: ReactNode
  wide?: boolean
  still?: boolean
}) {
  const branding = useBranding()
  const all = resolvePanelSlides(branding.portalLoginImageUrls)
  const slides = still ? all.slice(0, 1) : all

  return (
    <div
      className={cn(
        'auth-panel relative isolate flex min-h-screen items-center justify-center overflow-hidden bg-[#24296A] p-4 sm:p-6',
        `auth-panel-${slides.length}`
      )}
    >
      {slides.map((src, i) => (
        <img
          key={src}
          src={src}
          alt=""
          aria-hidden="true"
          fetchPriority={i === 0 ? 'high' : 'low'}
          className="auth-panel-slide"
          style={{ objectPosition: branding.portalLoginImagePosition }}
        />
      ))}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-b from-[#24296A]/90 via-[#24296A]/45 via-48% to-[#1A1E4F]"
      />
      <div className={cn('relative z-10 w-full', wide ? 'max-w-3xl' : 'max-w-md')}>{children}</div>
      <div className="absolute bottom-4 left-0 right-0 z-10 px-4 text-center text-xs text-white/70">
        &copy; {new Date().getFullYear()} {branding.name}. All rights reserved.
      </div>
    </div>
  )
}

function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <BaseCard
      className={cn(
        'w-full rounded-2xl border border-white/20 bg-white/10 p-6 text-white shadow-2xl backdrop-blur-xl transition-all sm:p-7',
        className
      )}
    >
      {children}
    </BaseCard>
  )
}

function IconChip({ children }: { children: ReactNode }) {
  return (
    <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/15 text-white ring-1 ring-white/25 backdrop-blur-md shadow-inner">
      {children}
    </span>
  )
}

const FIELD =
  'h-14 rounded-2xl border-white/20 bg-white/10 text-white placeholder:text-white/40 focus-visible:ring-2 focus-visible:ring-[#B8873A] focus-visible:border-[#B8873A] backdrop-blur-md'
const PRIMARY_BTN =
  'h-14 w-full rounded-2xl border border-[#B8873A]/60 bg-white text-base font-semibold text-[#24296A] shadow-lg transition-all hover:bg-white/90 active:scale-[0.99]'

// Downscale + re-encode a captured photo before upload. A raw tablet-camera shot
// can be 5–15 MB; that overran the API body limit (connection reset / dead dev
// server). Capping the long edge at 2000px @ JPEG q0.85 yields a clean ~0.3–1 MB
// image that's plenty for a kiosk reference capture. Falls back to the original
// file if anything goes wrong.
const MAX_EDGE = 2000
async function compressImage(file: File): Promise<File> {
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
    const w = Math.round(bitmap.width * scale)
    const h = Math.round(bitmap.height * scale)
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(bitmap, 0, 0, w, h)
    bitmap.close?.()
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.85)
    )
    if (!blob) return file
    const name = file.name.replace(/\.[^.]+$/, '') || 'xray'
    return new File([blob], `${name}.jpg`, { type: 'image/jpeg' })
  } catch {
    return file
  }
}

export default function KioskApp() {
  const [phase, setPhase] = useState<Phase>('loading')
  const [me, setMe] = useState<KioskMe | null>(null)
  const [caps, setCaps] = useState<string[]>([])

  const refreshMe = useCallback(async () => {
    const res = await getKioskMe()
    if (res.success && res.data) {
      setMe(res.data)
      setPhase((p) => (p === 'unlocked' ? 'unlocked' : 'locked'))
    } else {
      setMe(null)
      setPhase('unpaired')
    }
  }, [])

  useEffect(() => {
    refreshMe()
  }, [refreshMe])

  const lock = useCallback(async () => {
    await lockKiosk().catch(() => {})
    sessionStorage.removeItem('kiosk_mode')
    sessionStorage.removeItem('kiosk_operator')
    setCaps([])
    setPhase('locked')
  }, [])

  const kioskConfigQuery = useApiQuery(queryKeys.settings.kv('security:kiosk_config'), () =>
    api.get<{ idleLockSeconds?: number } | null>('/api/settings/kv/security:kiosk_config')
  )
  const idleLockMs =
    kioskConfigQuery.data?.idleLockSeconds != null
      ? kioskConfigQuery.data.idleLockSeconds * 1000
      : DEFAULT_IDLE_LOCK_MS

  // Auto-lock on idle whenever a session is open.
  useEffect(() => {
    if (phase !== 'unlocked') return
    let timer = window.setTimeout(lock, idleLockMs)
    const reset = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(lock, idleLockMs)
    }
    const events: Array<keyof WindowEventMap> = ['pointerdown', 'keydown']
    for (const e of events) window.addEventListener(e, reset)
    return () => {
      window.clearTimeout(timer)
      for (const e of events) window.removeEventListener(e, reset)
    }
  }, [phase, lock, idleLockMs])

  return (
    <Stage wide={phase === 'unlocked'} still={phase === 'unlocked'}>
      {phase === 'loading' && (
        <p className="text-center text-sm text-white/80 animate-pulse">Loading…</p>
      )}
      {phase === 'unpaired' && <PairScreen onPaired={refreshMe} />}
      {phase === 'locked' && me && (
        <LockScreen
          me={me}
          onUnlock={(c, session) => {
            setCaps(c)
            if (session?.operator) {
              sessionStorage.setItem('kiosk_mode', 'true')
              sessionStorage.setItem('kiosk_operator', JSON.stringify(session.operator))
            }
            if (
              me.device.surface === 'clinical' ||
              me.device.surface === 'doctor_station' ||
              me.device.surface === 'dashboard'
            ) {
              toast.success(`Welcome, ${session?.operator?.displayName || 'Doctor'}`)
              window.location.href = '/dashboard'
              return
            }
            setPhase('unlocked')
          }}
        />
      )}
      {phase === 'unlocked' && me && me.device.surface === 'consents' && (
        <ConsentScreen device={me.device} onLock={lock} />
      )}
      {phase === 'unlocked' && me && me.device.surface !== 'consents' && (
        <CaptureScreen device={me.device} capabilities={caps} onLock={lock} />
      )}
    </Stage>
  )
}

function PairScreen({ onPaired }: { onPaired: () => void }) {
  const branding = useBranding()
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    const trimmed = code.trim().toUpperCase()
    if (!trimmed) return
    setBusy(true)
    const res = await pairKiosk(trimmed)
    setBusy(false)
    if (res.success) {
      toast.success('Device paired successfully')
      onPaired()
    } else {
      toast.error(res.error || 'Pairing failed')
      setCode('')
    }
  }

  return (
    <Card>
      <div className="mb-6 flex flex-col items-center text-center">
        {branding.logoHorizontalUrl ? (
          <img
            src={branding.logoHorizontalUrl}
            alt={branding.name}
            className="max-h-10 mx-auto object-contain mb-2"
          />
        ) : branding.logoIconUrl ? (
          <img
            src={branding.logoIconUrl}
            alt={branding.name}
            className="h-10 w-10 mx-auto object-contain mb-2"
          />
        ) : (
          <img
            src={logoGold}
            alt={branding.name}
            className="mx-auto mb-2 max-h-12 object-contain"
          />
        )}
        <h1 className="font-heading text-2xl text-white">Pair this station</h1>
        <p className="text-sm text-white/70">Set up the kiosk for the first time</p>
      </div>
      <p className="mb-5 text-sm text-white/80 text-center">
        Enter the one-time pairing code generated in the admin portal.
      </p>
      <Input
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder="PAIRING CODE"
        autoFocus
        className={`${FIELD} mb-4 text-center font-mono text-xl uppercase tracking-[0.3em]`}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
      />
      <Button onClick={submit} disabled={busy || !code.trim()} className={PRIMARY_BTN}>
        {busy ? 'Pairing…' : 'Pair device'}
      </Button>
    </Card>
  )
}

function LockScreen({
  me,
  onUnlock,
}: {
  me: KioskMe
  onUnlock: (caps: string[], session?: KioskSession) => void
}) {
  const branding = useBranding()
  const [operatorId, setOperatorId] = useState('')
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = useCallback(
    async (pinValue: string) => {
      if (!operatorId || pinValue.length !== 6) return
      setBusy(true)
      const res = await openKioskSession(operatorId, pinValue)
      setBusy(false)
      if (res.success && res.data) {
        onUnlock(res.data.capabilities, res.data)
      } else {
        toast.error(res.error || 'Invalid operator or PIN')
        setPin('')
      }
    },
    [operatorId, onUnlock]
  )

  const press = useCallback(
    (digit: string) => {
      if (busy) return
      setPin((prev) => {
        if (prev.length >= 6) return prev
        const next = prev + digit
        if (next.length === 6) void submit(next) // auto-submit on the 6th digit
        return next
      })
    },
    [busy, submit]
  )
  const backspace = useCallback(() => setPin((p) => p.slice(0, -1)), [])

  // Hardware keyboard support (USB numpad kiosks).
  useEffect(() => {
    if (!operatorId) return
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) press(e.key)
      else if (e.key === 'Backspace') backspace()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [operatorId, press, backspace])

  const selectedOp = me.operators.find((o) => o.id === operatorId)
  const selectedName = selectedOp?.displayName || selectedOp?.name

  return (
    <Card>
      <div className="mb-6 flex flex-col items-center text-center">
        {branding.logoHorizontalUrl ? (
          <img
            src={branding.logoHorizontalUrl}
            alt={branding.name}
            className="max-h-10 mx-auto object-contain mb-2"
          />
        ) : branding.logoIconUrl ? (
          <img
            src={branding.logoIconUrl}
            alt={branding.name}
            className="h-10 w-10 mx-auto object-contain mb-2"
          />
        ) : (
          <img
            src={logoGold}
            alt={branding.name}
            className="mx-auto mb-2 max-h-12 object-contain"
          />
        )}
        <h1 className="font-heading text-2xl text-white">{me.device.label}</h1>
        <p className="text-sm capitalize text-white/70">
          {me.device.surface.replace(/_/g, ' ')} Kiosk Station
        </p>
      </div>

      {me.operators.length === 0 ? (
        <p className="rounded-2xl bg-white/10 p-4 text-sm text-white/70 text-center border border-white/15">
          No operators are provisioned for this station yet.
        </p>
      ) : !operatorId ? (
        <>
          <p className="mb-3 text-sm font-medium text-white/90">Select your profile</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-[45vh] overflow-y-auto pr-1">
            {me.operators.map((op) => (
              <button
                key={op.id}
                type="button"
                onClick={() => {
                  setOperatorId(op.id)
                  setPin('')
                }}
                className="group relative flex flex-col items-start gap-1 rounded-2xl border border-white/15 bg-white/10 p-4 text-left shadow-sm backdrop-blur transition-all hover:border-white/40 hover:bg-white/20 active:scale-[0.98]"
              >
                <div className="flex w-full items-center justify-between gap-1.5">
                  <span className="font-semibold text-white group-hover:text-white transition-colors">
                    {op.displayName || op.name || 'Operator'}
                  </span>
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wide uppercase ${
                      op.operatorType === 'doctor'
                        ? 'bg-[#24296A]/70 text-[#F0CA77] border border-[#B8873A]/50'
                        : 'bg-emerald-900/50 text-emerald-200 border border-emerald-600/40'
                    }`}
                  >
                    {op.title === 'Dr.' ? 'Doctor' : 'Dental Tech'}
                  </span>
                </div>
                <p className="text-xs text-white/60">
                  {op.specialty ||
                    (op.operatorType === 'doctor' ? 'Assigned Doctor' : 'Clinical Staff')}
                </p>
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="mb-5 flex items-center justify-between">
            <div className="flex flex-col">
              <p className="text-sm text-white/80">
                Hi <span className="font-semibold text-white">{selectedName}</span>
              </p>
              <span className="text-xs text-white/60">Enter your 6-digit Operator PIN</span>
            </div>
            <button
              type="button"
              onClick={() => {
                setOperatorId('')
                setPin('')
              }}
              className="rounded-lg px-2.5 py-1 text-xs font-semibold text-[#E4C076] hover:bg-white/10 hover:text-white transition-colors"
            >
              Switch Profile
            </button>
          </div>

          {/* PIN dots */}
          <div className="mb-6 flex justify-center gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <span
                key={`dot-${i}`}
                className={`h-3.5 w-3.5 rounded-full transition-all ${
                  i < pin.length
                    ? 'bg-[#B8873A] border-2 border-[#E4C076] shadow-md shadow-black/60 scale-110'
                    : 'bg-white/20 border border-white/10'
                }`}
              />
            ))}
          </div>

          {/* Keypad */}
          <div className="grid grid-cols-3 gap-2.5">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
              <KeypadButton key={d} onClick={() => press(d)} disabled={busy}>
                {d}
              </KeypadButton>
            ))}
            <div />
            <KeypadButton onClick={() => press('0')} disabled={busy}>
              0
            </KeypadButton>
            <KeypadButton onClick={backspace} disabled={busy} aria-label="Delete">
              <Delete className="mx-auto h-6 w-6" />
            </KeypadButton>
          </div>
          {busy && (
            <p className="mt-5 text-center text-sm font-medium text-[#E4C076] animate-pulse">
              Authenticating & Unlocking…
            </p>
          )}
        </>
      )}
    </Card>
  )
}

function KeypadButton({
  children,
  onClick,
  disabled,
  ...rest
}: {
  children: ReactNode
  onClick: () => void
  disabled?: boolean
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="h-16 rounded-2xl border border-white/15 bg-white/10 text-2xl font-semibold text-white shadow-sm backdrop-blur transition hover:bg-white/20 active:scale-[0.95] active:bg-[#24296A]/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B8873A] disabled:opacity-40"
      {...rest}
    >
      {children}
    </button>
  )
}

// Shared header for the working surfaces (capture / consent).
function SurfaceHeader({
  icon,
  title,
  onLock,
}: {
  icon: ReactNode
  title: string
  onLock: () => void
}) {
  return (
    <div className="mb-6 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <IconChip>{icon}</IconChip>
        <h1 className="font-heading text-xl text-white">{title}</h1>
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            window.location.href = '/dashboard'
          }}
          className="rounded-xl text-xs font-semibold bg-white/10 border-white/20 text-white hover:bg-white/20"
        >
          Doctor Dashboard
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onLock}
          className="rounded-xl text-white/80 hover:bg-white/10 hover:text-white"
        >
          <Lock className="mr-1.5 h-4 w-4" /> Lock
        </Button>
      </div>
    </div>
  )
}

function CaptureScreen({
  device,
  capabilities,
  onLock,
}: {
  device: KioskMe['device']
  capabilities: string[]
  onLock: () => void
}) {
  const canCapture = capabilities.includes('can_capture')
  const xrayTypesQuery = useApiQuery(['kiosk', 'xray-types'] as const, () => getKioskXrayTypes())
  const types = xrayTypesQuery.data ?? []
  const [q, setQ] = useState('')
  const [results, setResults] = useState<KioskPatient[]>([])
  const [patient, setPatient] = useState<KioskPatient | null>(null)
  const [xrayTypeId, setXrayTypeId] = useState('')
  const [notes, setNotes] = useState('')
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imageUrl, setImageUrl] = useState('') // local preview (data URL) only
  const [busy, setBusy] = useState(false)

  // Debounced patient search.
  useEffect(() => {
    if (patient) return
    const term = q.trim()
    if (term.length < 2) {
      setResults([])
      return
    }
    const t = setTimeout(async () => {
      const r = await searchKioskPatients(term)
      if (r.success && r.data) setResults(r.data)
    }, 250)
    return () => clearTimeout(t)
  }, [q, patient])

  const ready = useMemo(
    () => canCapture && !!patient && !!imageFile,
    [canCapture, patient, imageFile]
  )

  async function onFile(file: File | undefined) {
    if (!file) return
    const compressed = await compressImage(file)
    setImageFile(compressed)
    const reader = new FileReader()
    reader.onload = () => setImageUrl(String(reader.result))
    reader.readAsDataURL(compressed)
  }

  async function submit() {
    if (!patient || !imageFile) return
    setBusy(true)
    // 1) Upload the image to blob storage (multipart) → URL.
    const up = await uploadKioskXrayImage(imageFile)
    if (!up.success || !up.data?.url) {
      setBusy(false)
      toast.error(up.error || 'Image upload failed')
      return
    }
    // 2) Record the x-ray with the small URL payload.
    const res = await captureKioskXray({
      patientId: patient.id,
      imageUrl: up.data.url,
      xrayTypeId: xrayTypeId || null,
      notes: notes.trim() || null,
    })
    setBusy(false)
    if (res.success) {
      toast.success('X-ray captured')
      setPatient(null)
      setQ('')
      setResults([])
      setXrayTypeId('')
      setNotes('')
      setImageFile(null)
      setImageUrl('')
    } else {
      toast.error(res.error || 'Failed to save x-ray')
    }
  }

  return (
    <Card>
      <SurfaceHeader icon={<Camera className="h-6 w-6" />} title="Capture X-ray" onLock={onLock} />

      {!canCapture && (
        <p className="mb-4 rounded-2xl bg-amber-500/20 border border-amber-500/30 p-3 text-sm font-medium text-amber-200">
          You don't have capture permission on this station.
        </p>
      )}

      {/* Patient */}
      {patient ? (
        <div className="mb-4 flex items-center justify-between rounded-2xl bg-white/10 border border-white/20 p-3.5 backdrop-blur">
          <div>
            <p className="font-semibold text-white">{patient.name}</p>
            {patient.phone && <p className="text-sm text-white/70">{patient.phone}</p>}
          </div>
          <button
            type="button"
            onClick={() => setPatient(null)}
            className="rounded-full p-1 text-white/70 hover:bg-white/20 hover:text-white"
            aria-label="Change patient"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      ) : (
        <div className="mb-4">
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/50" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search patient by name or phone…"
              className={`${FIELD} h-12 pl-10`}
            />
          </div>
          {results.length > 0 && (
            <div className="mt-1.5 max-h-48 overflow-y-auto rounded-2xl border border-white/20 bg-slate-900/90 shadow-xl backdrop-blur-xl">
              {results.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPatient(p)}
                  className="block w-full px-4 py-2.5 text-left text-sm text-white hover:bg-white/15"
                >
                  {p.name}
                  {p.phone ? ` · ${p.phone}` : ''}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Type */}
      <select
        value={xrayTypeId}
        onChange={(e) => setXrayTypeId(e.target.value)}
        className="mb-4 h-12 w-full rounded-2xl border border-white/20 bg-white/10 px-3.5 text-sm text-white backdrop-blur [&>option]:bg-slate-900 [&>option]:text-white"
      >
        <option value="">X-ray type (optional)</option>
        {types.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>

      {/* Image */}
      <label className="mb-4 flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-white/20 bg-white/5 p-6 text-white/80 transition-colors hover:border-[#B8873A] hover:bg-white/10">
        <input
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => onFile(e.target.files?.[0])}
          disabled={!canCapture}
        />
        {imageUrl ? (
          <img src={imageUrl} alt="capture preview" className="max-h-40 rounded-xl" />
        ) : (
          <span className="flex items-center gap-2 font-medium">
            <Camera className="h-5 w-5" /> Take / choose image
          </span>
        )}
      </label>

      <Input
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Notes (optional)"
        className={`${FIELD} mb-4 h-12 text-left`}
      />

      <Button onClick={submit} disabled={busy || !ready} className={PRIMARY_BTN}>
        {busy ? 'Saving…' : 'Save X-ray'}
      </Button>
    </Card>
  )
}

// ── Consent surface (§18.4) ──────────────────────────────────────────────────

function ConsentScreen({ device, onLock }: { device: KioskMe['device']; onLock: () => void }) {
  const templatesQuery = useApiQuery(['kiosk', 'consent-templates'] as const, () =>
    getKioskConsentTemplates()
  )
  const templates = templatesQuery.data ?? []
  const [q, setQ] = useState('')
  const [results, setResults] = useState<KioskPatient[]>([])
  const [patient, setPatient] = useState<KioskPatient | null>(null)
  const [template, setTemplate] = useState<KioskConsentTemplate | null>(null)
  const [step, setStep] = useState<'search' | 'pick' | 'sign'>('search')
  const [busy, setBusy] = useState(false)
  const [sigData, setSigData] = useState<string | null>(null)

  useEffect(() => {
    if (patient) return
    const term = q.trim()
    if (term.length < 2) {
      setResults([])
      return
    }
    const t = setTimeout(async () => {
      const r = await searchKioskConsentPatients(term)
      if (r.success && r.data) setResults(r.data)
    }, 250)
    return () => clearTimeout(t)
  }, [q, patient])

  async function submit() {
    if (!sigData || !patient || !template) return
    setBusy(true)
    const res = await signKioskConsent({
      templateId: template.id,
      patientId: patient.id,
      patientName: patient.name,
      signatureDataUrl: sigData,
    })
    setBusy(false)
    if (res.success) {
      toast.success('Consent recorded')
      setPatient(null)
      setTemplate(null)
      setQ('')
      setResults([])
      setStep('search')
    } else {
      toast.error(res.error || 'Failed to save consent')
    }
  }

  return (
    <Card>
      <SurfaceHeader
        icon={<ClipboardList className="h-6 w-6" />}
        title="Consent Signing"
        onLock={onLock}
      />

      {step === 'search' && (
        <>
          <p className="mb-4 text-sm text-white/80">Search for the patient to consent.</p>
          {patient ? (
            <div className="mb-4 flex items-center justify-between rounded-2xl bg-white/10 border border-white/20 p-3.5 backdrop-blur">
              <div>
                <p className="font-semibold text-white">{patient.name}</p>
                {patient.phone && <p className="text-sm text-white/70">{patient.phone}</p>}
              </div>
              <button
                type="button"
                onClick={() => {
                  setPatient(null)
                  setQ('')
                }}
                className="rounded-full p-1 text-white/70 hover:bg-white/20 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          ) : (
            <div className="mb-4">
              <div className="relative">
                <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/50" />
                <Input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search patient by name or phone…"
                  className={`${FIELD} h-12 pl-10`}
                />
              </div>
              {results.length > 0 && (
                <div className="mt-1.5 max-h-48 overflow-y-auto rounded-2xl border border-white/20 bg-slate-900/90 shadow-xl backdrop-blur-xl">
                  {results.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        setPatient(p)
                        setResults([])
                      }}
                      className="block w-full px-4 py-2.5 text-left text-sm text-white hover:bg-white/15"
                    >
                      {p.name}
                      {p.phone ? ` · ${p.phone}` : ''}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <Button onClick={() => setStep('pick')} disabled={!patient} className={PRIMARY_BTN}>
            Next — choose form
          </Button>
        </>
      )}

      {step === 'pick' && (
        <>
          <p className="mb-4 text-sm text-white/80">
            Patient: <span className="font-semibold text-white">{patient?.name}</span>
          </p>
          {templates.length === 0 ? (
            <p className="rounded-2xl bg-white/10 border border-white/20 p-4 text-sm text-white/70">
              No consent templates available. Create one in Documents → Templates with category{' '}
              <strong>consent</strong>.
            </p>
          ) : (
            <div className="mb-4 max-h-64 space-y-2 overflow-y-auto">
              {templates.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    setTemplate(t)
                    setStep('sign')
                  }}
                  className="block w-full rounded-2xl border border-white/20 bg-white/10 px-4 py-3.5 text-left text-sm font-semibold text-white shadow-sm backdrop-blur transition-colors hover:border-white/40 hover:bg-white/20"
                >
                  {t.name}
                  {t.description && (
                    <span className="mt-0.5 block text-xs font-normal text-white/70">
                      {t.description}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
          <Button
            variant="ghost"
            onClick={() => setStep('search')}
            className="h-12 w-full rounded-2xl text-white/80 hover:bg-white/10 hover:text-white"
          >
            Back
          </Button>
        </>
      )}

      {step === 'sign' && (
        <>
          <p className="text-sm text-white/80">
            Patient: <span className="font-semibold text-white">{patient?.name}</span>
          </p>
          <p className="mb-4 text-sm font-semibold text-white">{template?.name}</p>
          <p className="mb-2 text-xs font-medium text-white/80">Sign below</p>
          <div className="rounded-2xl overflow-hidden bg-white/95 p-1 mb-4">
            <SignaturePad onChange={setSigData} />
          </div>

          <Button onClick={submit} disabled={busy || !sigData} className={PRIMARY_BTN}>
            <PenLine className="mr-2 h-5 w-5" />
            {busy ? 'Saving…' : 'Submit consent'}
          </Button>
          <Button
            variant="ghost"
            onClick={() => setStep('pick')}
            disabled={busy}
            className="mt-2 h-12 w-full rounded-2xl text-white/80 hover:bg-white/10 hover:text-white"
          >
            Back
          </Button>
          <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-white/70">
            <ShieldCheck className="h-3.5 w-3.5" /> Captured securely at {device.label}
          </p>
        </>
      )}
    </Card>
  )
}
