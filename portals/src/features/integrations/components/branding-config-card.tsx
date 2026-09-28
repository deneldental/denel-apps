import {
  ArrowLeft,
  ArrowRight,
  Building2,
  ImageIcon,
  Palette,
  Plus,
  Trash2,
  Upload,
  Wallet,
  X,
} from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  type BrandingConfig,
  type BrandingUploadKind,
  getBranding,
  saveBranding,
  uploadBrandingFile,
} from '@/lib/actions/branding'
import { useApiMutation, useApiQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query-keys'
import { cn } from '@/lib/utils'
import { Button } from '@/shared/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { Textarea } from '@/shared/components/ui/textarea'

/** Must match MAX_PANEL_SLIDES in auth-layout.tsx and the keyframe sets in globals.css. */
const MAX_LOGIN_IMAGES = 6

/**
 * `mode` controls which slice of the branding config this card edits:
 *   - `info`   → name, contact, outbound channels, legal, social (Clinic Info tab)
 *   - `assets` → logos + login/background images (Brand Assets tab)
 *   - `full`   → everything, including the colour editor (legacy / standalone)
 * All modes fetch and save the whole `BrandingConfig` object, so a save from
 * one tab re-persists the other's fields as last loaded from the server.
 */
type BrandingCardMode = 'info' | 'assets' | 'full'

const SOCIAL_FIELDS: Array<{ key: keyof BrandingConfig['social']; label: string }> = [
  { key: 'facebook', label: 'Facebook' },
  { key: 'instagram', label: 'Instagram' },
  { key: 'tiktok', label: 'TikTok' },
  { key: 'youtube', label: 'YouTube' },
  { key: 'linkedin', label: 'LinkedIn' },
  { key: 'snapchat', label: 'Snapchat' },
]

const POSITION_GRID = [
  ['left top', 'center top', 'right top'],
  ['left center', 'center center', 'right center'],
  ['left bottom', 'center bottom', 'right bottom'],
]

function PositionGrid({ value, onChange }: { value: string; onChange: (pos: string) => void }) {
  return (
    <div className="inline-grid grid-cols-3 gap-1.5">
      {POSITION_GRID.flat().map((pos) => (
        <button
          key={pos}
          type="button"
          title={pos}
          onClick={() => onChange(pos)}
          className={cn(
            'h-6 w-6 rounded border-2 transition-colors',
            value === pos
              ? 'border-primary bg-primary'
              : 'border-border bg-muted hover:border-primary/50'
          )}
        />
      ))}
    </div>
  )
}

function CompositionPreview({
  loginImageUrl,
  loginImagePosition,
  themeColor,
  accentColor,
  name,
}: {
  loginImageUrl: string | null
  loginImagePosition: string
  themeColor: string
  accentColor: string
  name: string
}) {
  return (
    <div
      className="relative rounded-xl overflow-hidden shrink-0"
      style={{
        width: 220,
        height: 130,
        ...(loginImageUrl
          ? {
              backgroundImage: `url(${loginImageUrl})`,
              backgroundSize: 'cover',
              backgroundPosition: loginImagePosition,
            }
          : {
              background: `linear-gradient(135deg, ${themeColor}, ${accentColor})`,
            }),
      }}
    >
      <div className="absolute inset-0 bg-black/40" />
      <div className="absolute inset-0 flex items-center justify-center p-4">
        <div className="bg-white/10 backdrop-blur-sm border border-white/20 rounded-xl p-3 w-full max-w-[140px] text-center shadow-lg">
          <p className="text-white text-[11px] font-semibold truncate">{name}</p>
          <p className="text-white/70 text-[9px] mt-0.5">Welcome back</p>
        </div>
      </div>
    </div>
  )
}

function normalizeHex(val: string): string | null {
  const trimmed = val.startsWith('#') ? val : `#${val}`
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed.toLowerCase()
  return null
}

export function BrandingConfigCard({ mode = 'full' }: { mode?: BrandingCardMode } = {}) {
  const showInfo = mode !== 'assets'
  const showAssets = mode !== 'info'
  const showColors = mode === 'full'

  const query = useApiQuery(queryKeys.settings.branding(), getBranding)
  const saveMutation = useApiMutation(saveBranding, {
    invalidates: [queryKeys.settings.branding()],
  })

  const [data, setData] = useState<BrandingConfig | null>(null)
  const loading = query.isLoading
  const saving = saveMutation.isPending

  const [logoUploading, setLogoUploading] = useState(false)
  const [faviconUploading, setFaviconUploading] = useState(false)
  const [logoIconUploading, setLogoIconUploading] = useState(false)
  const [logoHorizontalUploading, setLogoHorizontalUploading] = useState(false)
  const [portalLoginImageUploading, setPortalLoginImageUploading] = useState(false)
  const [pwaLoginImageUploading, setPwaLoginImageUploading] = useState(false)

  const logoInput = useRef<HTMLInputElement>(null)
  const faviconInput = useRef<HTMLInputElement>(null)
  const logoIconInput = useRef<HTMLInputElement>(null)
  const logoHorizontalInput = useRef<HTMLInputElement>(null)
  const portalLoginImageInput = useRef<HTMLInputElement>(null)
  const pwaLoginImageInput = useRef<HTMLInputElement>(null)

  const [primaryHex, setPrimaryHex] = useState('')
  const [accentHex, setAccentHex] = useState('')
  const hexInitialized = useRef(false)

  const idBase = useId()

  useEffect(() => {
    if (!query.data) return
    setData(query.data)
    if (!hexInitialized.current) {
      setPrimaryHex(query.data.themeColor)
      setAccentHex(query.data.accentColor)
      hexInitialized.current = true
    }
  }, [query.data])

  const update = <K extends keyof BrandingConfig>(key: K, value: BrandingConfig[K]) => {
    if (!data) return
    setData({ ...data, [key]: value })
  }
  const updateSocial = (key: keyof BrandingConfig['social'], value: string) => {
    if (!data) return
    setData({ ...data, social: { ...data.social, [key]: value || undefined } })
  }
  const updatePhone = (i: number, value: string) => {
    if (!data) return
    const phones = [...data.phones]
    phones[i] = value
    setData({ ...data, phones })
  }
  const addPhone = () => {
    if (!data) return
    setData({ ...data, phones: [...data.phones, ''] })
  }
  const removePhone = (i: number) => {
    if (!data) return
    setData({ ...data, phones: data.phones.filter((_, idx) => idx !== i) })
  }

  const uploadingMap: Record<BrandingUploadKind, (v: boolean) => void> = {
    logo: setLogoUploading,
    favicon: setFaviconUploading,
    'logo-icon': setLogoIconUploading,
    'logo-horizontal': setLogoHorizontalUploading,
    'portal-login-image': setPortalLoginImageUploading,
    'pwa-login-image': setPwaLoginImageUploading,
  }
  const fieldMap: Record<BrandingUploadKind, keyof BrandingConfig> = {
    logo: 'logoUrl',
    favicon: 'faviconUrl',
    'logo-icon': 'logoIconUrl',
    'logo-horizontal': 'logoHorizontalUrl',
    'portal-login-image': 'portalLoginImageUrl',
    'pwa-login-image': 'pwaLoginImageUrl',
  }

  const handleUpload = async (kind: BrandingUploadKind, file: File | null) => {
    if (!file || !data) return
    uploadingMap[kind](true)
    const res = await uploadBrandingFile(file, kind)
    uploadingMap[kind](false)
    if (res.success && res.data) {
      const url = `${res.data.url}?v=${Date.now()}`
      setData({ ...data, [fieldMap[kind]]: url })
      toast.success(`${kind.replace(/-/g, ' ')} uploaded`)
    } else {
      toast.error(res.error || 'Upload failed')
    }
  }

  /**
   * Login photos are a list, so an upload appends rather than replaces. Several
   * files can be picked at once; they upload in sequence and land in that order.
   * `portalLoginImageUrl` is kept as the first entry — the kiosk and the public
   * branding payload still read the singular field.
   */
  const handleLoginImageUpload = async (files: FileList | null) => {
    if (!files?.length || !data) return
    const current = data.portalLoginImageUrls ?? []
    const room = MAX_LOGIN_IMAGES - current.length
    if (room <= 0) {
      toast.error(`You can use up to ${MAX_LOGIN_IMAGES} photos`)
      return
    }
    const picked = Array.from(files).slice(0, room)
    setPortalLoginImageUploading(true)
    const uploaded: string[] = []
    for (const file of picked) {
      const res = await uploadBrandingFile(file, 'portal-login-image')
      if (res.success && res.data) uploaded.push(res.data.url)
      else toast.error(res.error || `Could not upload ${file.name}`)
    }
    setPortalLoginImageUploading(false)
    if (!uploaded.length) return
    const next = [...current, ...uploaded]
    setData({ ...data, portalLoginImageUrls: next, portalLoginImageUrl: next[0] ?? null })
    toast.success(uploaded.length === 1 ? 'Photo added' : `${uploaded.length} photos added`)
  }

  const setLoginImages = (next: string[]) => {
    if (!data) return
    setData({ ...data, portalLoginImageUrls: next, portalLoginImageUrl: next[0] ?? null })
  }

  const removeLoginImage = (index: number) =>
    setLoginImages((data?.portalLoginImageUrls ?? []).filter((_, i) => i !== index))

  const moveLoginImage = (index: number, delta: number) => {
    const list = [...(data?.portalLoginImageUrls ?? [])]
    const target = index + delta
    if (target < 0 || target >= list.length) return
    ;[list[index], list[target]] = [list[target], list[index]]
    setLoginImages(list)
  }

  const handleSave = async () => {
    if (!data) return
    if (data.smsSenderId.length > 11) {
      toast.error('SMS Sender ID must be 11 characters or fewer')
      return
    }
    const phones = data.phones.map((p) => p.trim()).filter(Boolean)
    try {
      await saveMutation.mutateAsync({ ...data, phones })
      toast.success('Saved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save')
    }
  }

  if (loading || !data) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">Loading…</CardContent>
      </Card>
    )
  }

  const header =
    mode === 'assets'
      ? {
          icon: <ImageIcon className="h-5 w-5" />,
          title: 'Brand Assets',
          desc: 'Logos and login / background images used across the portal, PWA and login pages.',
          saveLabel: 'Save brand assets',
        }
      : mode === 'info'
        ? {
            icon: <Building2 className="h-5 w-5" />,
            title: 'Clinic Info',
            desc: 'Clinic name, contact details, outbound sender identities, and social handles.',
            saveLabel: 'Save clinic info',
          }
        : {
            icon: <Palette className="h-5 w-5" />,
            title: 'Branding',
            desc: 'Clinic name, logos, colors, login image, contact info, and outbound settings.',
            saveLabel: 'Save branding',
          }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {header.icon}
          {header.title}
        </CardTitle>
        <CardDescription>{header.desc}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-8">
        {/* ── Identity ─────────────────────────────────────────────────────── */}
        {showInfo && (
          <section className="space-y-4">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              Identity
            </h3>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor={`${idBase}-name`}>Clinic name (long)</Label>
                <Input
                  id={`${idBase}-name`}
                  value={data.name}
                  onChange={(e) => update('name', e.target.value)}
                  placeholder="Denel Dental Clinic"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${idBase}-short`}>Short name</Label>
                <Input
                  id={`${idBase}-short`}
                  value={data.shortName}
                  onChange={(e) => update('shortName', e.target.value)}
                  placeholder="Denel"
                />
                <p className="text-xs text-muted-foreground">Used in SMS bodies and compact UI.</p>
              </div>
            </div>
          </section>
        )}

        {/* ── Logos ────────────────────────────────────────────────────────── */}
        {showAssets && (
          <section className="space-y-4">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              Logos
            </h3>

            <div className="grid gap-6 md:grid-cols-2">
              {/* Logo Icon */}
              <div className="space-y-2">
                <Label>
                  Logo Icon{' '}
                  <span className="text-xs text-muted-foreground font-normal">
                    (SVG / PNG / WebP)
                  </span>
                </Label>
                <p className="text-xs text-muted-foreground">
                  Square mark — sidebar collapsed, app badge.
                </p>
                <div className="flex items-start gap-3">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-muted">
                    {data.logoIconUrl ? (
                      <img
                        src={data.logoIconUrl}
                        alt="Icon"
                        className="h-full w-full object-contain"
                      />
                    ) : (
                      <span className="text-xs text-muted-foreground">none</span>
                    )}
                  </div>
                  <div className="flex flex-col gap-2">
                    <input
                      ref={logoIconInput}
                      type="file"
                      accept=".svg,.png,.webp,image/svg+xml,image/png,image/webp"
                      className="hidden"
                      onChange={(e) => handleUpload('logo-icon', e.target.files?.[0] ?? null)}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => logoIconInput.current?.click()}
                      disabled={logoIconUploading}
                    >
                      <Upload className="mr-1.5 h-3.5 w-3.5" />
                      {logoIconUploading ? 'Uploading…' : 'Upload icon'}
                    </Button>
                    {data.logoIconUrl && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => update('logoIconUrl', null)}
                      >
                        <X className="mr-1.5 h-3.5 w-3.5" />
                        Remove
                      </Button>
                    )}
                  </div>
                </div>
              </div>

              {/* Logo Horizontal */}
              <div className="space-y-2">
                <Label>
                  Logo Horizontal{' '}
                  <span className="text-xs text-muted-foreground font-normal">
                    (SVG / PNG / WebP)
                  </span>
                </Label>
                <p className="text-xs text-muted-foreground">
                  Wide mark — sidebar expanded, login pages.
                </p>
                <div className="flex items-start gap-3">
                  <div className="flex h-12 w-[120px] shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-muted">
                    {data.logoHorizontalUrl ? (
                      <img
                        src={data.logoHorizontalUrl}
                        alt="Horizontal"
                        className="h-full w-full object-contain"
                      />
                    ) : (
                      <span className="text-xs text-muted-foreground">none</span>
                    )}
                  </div>
                  <div className="flex flex-col gap-2">
                    <input
                      ref={logoHorizontalInput}
                      type="file"
                      accept=".svg,.png,.webp,image/svg+xml,image/png,image/webp"
                      className="hidden"
                      onChange={(e) => handleUpload('logo-horizontal', e.target.files?.[0] ?? null)}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => logoHorizontalInput.current?.click()}
                      disabled={logoHorizontalUploading}
                    >
                      <Upload className="mr-1.5 h-3.5 w-3.5" />
                      {logoHorizontalUploading ? 'Uploading…' : 'Upload horizontal'}
                    </Button>
                    {data.logoHorizontalUrl && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => update('logoHorizontalUrl', null)}
                      >
                        <X className="mr-1.5 h-3.5 w-3.5" />
                        Remove
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Sidebar preview */}
            <div>
              <p className="text-xs text-muted-foreground mb-2">Sidebar preview</p>
              <div className="flex gap-4 items-end">
                <div>
                  <p className="text-[10px] text-muted-foreground text-center mb-1">Collapsed</p>
                  <div className="w-10 h-16 bg-gray-100 dark:bg-gray-800 border border-border rounded-lg flex items-center justify-center">
                    {data.logoIconUrl ? (
                      <img src={data.logoIconUrl} alt="" className="h-6 w-6 object-contain" />
                    ) : (
                      <Wallet className="h-5 w-5 text-muted-foreground" />
                    )}
                  </div>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground text-center mb-1">Expanded</p>
                  <div className="w-36 h-16 bg-gray-100 dark:bg-gray-800 border border-border rounded-lg flex items-center px-3 gap-2">
                    {data.logoHorizontalUrl ? (
                      <img
                        src={data.logoHorizontalUrl}
                        alt=""
                        className="max-w-[100px] h-7 object-contain"
                      />
                    ) : data.logoIconUrl ? (
                      <>
                        <img
                          src={data.logoIconUrl}
                          alt=""
                          className="h-5 w-5 object-contain shrink-0"
                        />
                        <span className="text-xs font-semibold truncate">
                          {data.shortName || 'Clinic'}
                        </span>
                      </>
                    ) : (
                      <>
                        <Wallet className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="text-xs font-semibold truncate">
                          {data.shortName || 'Clinic'}
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Legacy uploads */}
            <div className="grid gap-4 md:grid-cols-2 pt-2 border-t">
              <div className="space-y-1.5">
                <Label>General / fallback logo</Label>
                <div className="flex items-start gap-3">
                  <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted">
                    {data.logoUrl ? (
                      <img src={data.logoUrl} alt="Logo" className="h-full w-full object-contain" />
                    ) : (
                      <span className="text-xs text-muted-foreground">none</span>
                    )}
                  </div>
                  <div className="flex-1 space-y-2">
                    <input
                      ref={logoInput}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => handleUpload('logo', e.target.files?.[0] ?? null)}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => logoInput.current?.click()}
                      disabled={logoUploading}
                    >
                      <Upload className="mr-1.5 h-3.5 w-3.5" />
                      {logoUploading ? 'Uploading…' : 'Upload logo'}
                    </Button>
                    {data.logoUrl && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => update('logoUrl', null)}
                      >
                        <X className="mr-1.5 h-3.5 w-3.5" />
                        Remove
                      </Button>
                    )}
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Favicon</Label>
                <div className="flex items-start gap-3">
                  <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted">
                    {data.faviconUrl ? (
                      <img
                        src={data.faviconUrl}
                        alt="Favicon"
                        className="h-full w-full object-contain"
                      />
                    ) : (
                      <span className="text-xs text-muted-foreground">none</span>
                    )}
                  </div>
                  <div className="flex-1 space-y-2">
                    <input
                      ref={faviconInput}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => handleUpload('favicon', e.target.files?.[0] ?? null)}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => faviconInput.current?.click()}
                      disabled={faviconUploading}
                    >
                      <Upload className="mr-1.5 h-3.5 w-3.5" />
                      {faviconUploading ? 'Uploading…' : 'Upload favicon'}
                    </Button>
                    {data.faviconUrl && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => update('faviconUrl', null)}
                      >
                        <X className="mr-1.5 h-3.5 w-3.5" />
                        Remove
                      </Button>
                    )}
                    <p className="text-xs text-muted-foreground">
                      Requires a PWA redeploy to take effect.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* ── Colors ───────────────────────────────────────────────────────── */}
        {showColors && (
          <section className="space-y-4">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              Colors
            </h3>
            <div className="grid gap-6 md:grid-cols-2">
              {/* Primary */}
              <div className="space-y-2">
                <Label>Primary color</Label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={data.themeColor}
                    onChange={(e) => {
                      update('themeColor', e.target.value)
                      setPrimaryHex(e.target.value)
                    }}
                    className="h-9 w-12 cursor-pointer rounded border"
                  />
                  <Input
                    value={primaryHex}
                    onChange={(e) => setPrimaryHex(e.target.value)}
                    onBlur={() => {
                      const normalized = normalizeHex(primaryHex)
                      if (normalized) {
                        update('themeColor', normalized)
                        setPrimaryHex(normalized)
                      } else {
                        setPrimaryHex(data.themeColor)
                      }
                    }}
                    placeholder="#16a34a"
                    className="font-mono w-28"
                    maxLength={7}
                  />
                </div>
                <div className="flex items-center gap-3">
                  <div
                    className="h-8 w-20 rounded-md"
                    style={{ backgroundColor: data.themeColor }}
                  />
                  <span className="text-sm font-medium" style={{ color: data.themeColor }}>
                    Sample text
                  </span>
                </div>
              </div>

              {/* Accent */}
              <div className="space-y-2">
                <Label>Accent color</Label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={data.accentColor}
                    onChange={(e) => {
                      update('accentColor', e.target.value)
                      setAccentHex(e.target.value)
                    }}
                    className="h-9 w-12 cursor-pointer rounded border"
                  />
                  <Input
                    value={accentHex}
                    onChange={(e) => setAccentHex(e.target.value)}
                    onBlur={() => {
                      const normalized = normalizeHex(accentHex)
                      if (normalized) {
                        update('accentColor', normalized)
                        setAccentHex(normalized)
                      } else {
                        setAccentHex(data.accentColor)
                      }
                    }}
                    placeholder="#8b5cf6"
                    className="font-mono w-28"
                    maxLength={7}
                  />
                </div>
                <div className="flex items-center gap-3">
                  <div
                    className="h-8 w-20 rounded-md"
                    style={{ backgroundColor: data.accentColor }}
                  />
                  <span className="text-sm font-medium" style={{ color: data.accentColor }}>
                    Sample text
                  </span>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* ── Login / background images ────────────────────────────────────── */}
        {showAssets && (
          <section className="space-y-4">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              Login / background images
            </h3>
            <div className="grid gap-8 md:grid-cols-2">
              {/* Portal */}
              <div className="space-y-3">
                <p className="text-sm font-medium">
                  Portal{' '}
                  <span className="text-xs text-muted-foreground font-normal">
                    (portal.deneldental.com)
                  </span>
                </p>
                <div className="flex flex-col gap-3">
                  <div className="space-y-2">
                    <input
                      ref={portalLoginImageInput}
                      type="file"
                      multiple
                      accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
                      className="hidden"
                      onChange={(e) => {
                        handleLoginImageUpload(e.target.files)
                        e.target.value = ''
                      }}
                    />
                    {(data.portalLoginImageUrls ?? []).length > 0 ? (
                      <ul className="flex flex-wrap gap-3">
                        {(data.portalLoginImageUrls ?? []).map((url, i) => (
                          <li key={url}>
                            <div className="relative">
                              <img
                                src={url}
                                alt={`Sign-in photo ${i + 1}`}
                                className="h-12 w-20 rounded-lg border object-cover"
                                style={{ objectPosition: data.portalLoginImagePosition }}
                              />
                              <span className="absolute left-1 top-1 rounded bg-black/60 px-1 text-[10px] leading-4 text-white">
                                {i + 1}
                              </span>
                            </div>
                            <div className="mt-1 flex justify-center gap-0.5">
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6"
                                onClick={() => moveLoginImage(i, -1)}
                                disabled={i === 0}
                                aria-label={`Move photo ${i + 1} earlier`}
                              >
                                <ArrowLeft className="h-3 w-3" />
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6"
                                onClick={() => moveLoginImage(i, 1)}
                                disabled={i === (data.portalLoginImageUrls ?? []).length - 1}
                                aria-label={`Move photo ${i + 1} later`}
                              >
                                <ArrowRight className="h-3 w-3" />
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6"
                                onClick={() => removeLoginImage(i)}
                                aria-label={`Remove photo ${i + 1}`}
                              >
                                <X className="h-3 w-3" />
                              </Button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        Using the built-in Denel photos.
                      </p>
                    )}
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => portalLoginImageInput.current?.click()}
                        disabled={
                          portalLoginImageUploading ||
                          (data.portalLoginImageUrls ?? []).length >= MAX_LOGIN_IMAGES
                        }
                      >
                        <Upload className="mr-1.5 h-3.5 w-3.5" />
                        {portalLoginImageUploading ? 'Uploading…' : 'Add photos'}
                      </Button>
                      <span className="text-xs text-muted-foreground">
                        {(data.portalLoginImageUrls ?? []).length} of {MAX_LOGIN_IMAGES} — two or
                        more cross-fade on the sign-in screen
                      </span>
                    </div>
                  </div>
                  <div className="flex items-start gap-4">
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">Focal point</p>
                      <PositionGrid
                        value={data.portalLoginImagePosition}
                        onChange={(pos) => update('portalLoginImagePosition', pos)}
                      />
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">Preview</p>
                      <CompositionPreview
                        loginImageUrl={data.portalLoginImageUrl}
                        loginImagePosition={data.portalLoginImagePosition}
                        themeColor={data.themeColor}
                        accentColor={data.accentColor}
                        name={data.name}
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* PWA */}
              <div className="space-y-3">
                <p className="text-sm font-medium">
                  PWA{' '}
                  <span className="text-xs text-muted-foreground font-normal">
                    (app.deneldental.com — falls back to built-in image)
                  </span>
                </p>
                <div className="flex flex-col gap-3">
                  <div className="flex items-start gap-3">
                    <div className="flex h-12 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-muted">
                      {data.pwaLoginImageUrl ? (
                        <img
                          src={data.pwaLoginImageUrl}
                          alt="PWA login bg"
                          className="h-full w-full object-cover"
                          style={{ objectPosition: data.pwaLoginImagePosition }}
                        />
                      ) : (
                        <span className="text-xs text-muted-foreground">built-in</span>
                      )}
                    </div>
                    <div className="flex flex-col gap-2">
                      <input
                        ref={pwaLoginImageInput}
                        type="file"
                        accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
                        className="hidden"
                        onChange={(e) =>
                          handleUpload('pwa-login-image', e.target.files?.[0] ?? null)
                        }
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => pwaLoginImageInput.current?.click()}
                        disabled={pwaLoginImageUploading}
                      >
                        <Upload className="mr-1.5 h-3.5 w-3.5" />
                        {pwaLoginImageUploading ? 'Uploading…' : 'Upload'}
                      </Button>
                      {data.pwaLoginImageUrl && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => update('pwaLoginImageUrl', null)}
                        >
                          <X className="mr-1.5 h-3.5 w-3.5" />
                          Remove
                        </Button>
                      )}
                    </div>
                  </div>
                  <div className="flex items-start gap-4">
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">Focal point</p>
                      <PositionGrid
                        value={data.pwaLoginImagePosition}
                        onChange={(pos) => update('pwaLoginImagePosition', pos)}
                      />
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">Preview</p>
                      <CompositionPreview
                        loginImageUrl={data.pwaLoginImageUrl}
                        loginImagePosition={data.pwaLoginImagePosition}
                        themeColor={data.themeColor}
                        accentColor={data.accentColor}
                        name={data.name}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* ── Outbound channels ────────────────────────────────────────────── */}
        {showInfo && (
          <section className="space-y-4">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              Outbound channels
            </h3>
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor={`${idBase}-sender`}>SMS Sender ID</Label>
                <Input
                  id={`${idBase}-sender`}
                  value={data.smsSenderId}
                  onChange={(e) => update('smsSenderId', e.target.value)}
                  maxLength={11}
                  placeholder="Denel"
                />
                <p className="text-xs text-muted-foreground">Max 11 chars.</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${idBase}-emailname`}>Email From — display</Label>
                <Input
                  id={`${idBase}-emailname`}
                  value={data.emailFromName}
                  onChange={(e) => update('emailFromName', e.target.value)}
                  placeholder="Denel Dental"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${idBase}-emailaddr`}>Email From — address</Label>
                <Input
                  id={`${idBase}-emailaddr`}
                  type="email"
                  value={data.emailFromAddress}
                  onChange={(e) => update('emailFromAddress', e.target.value)}
                  placeholder="info@deneldental.com"
                />
              </div>
            </div>
          </section>
        )}

        {/* ── Contact ──────────────────────────────────────────────────────── */}
        {showInfo && (
          <section className="space-y-4">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              Contact
            </h3>
            <div className="space-y-2">
              <Label>Phone numbers</Label>
              {data.phones.length === 0 && (
                <p className="text-xs text-muted-foreground">No phones configured.</p>
              )}
              {data.phones.map((p, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: stable enough for an editable list
                <div key={i} className="flex items-center gap-2">
                  <Input
                    value={p}
                    onChange={(e) => updatePhone(i, e.target.value)}
                    placeholder="+233..."
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => removePhone(i)}
                    title="Remove"
                    aria-label="Remove"
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" onClick={addPhone}>
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                Add phone
              </Button>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor={`${idBase}-email`}>Public email</Label>
                <Input
                  id={`${idBase}-email`}
                  type="email"
                  value={data.email ?? ''}
                  onChange={(e) => update('email', e.target.value || null)}
                  placeholder="info@example.com"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${idBase}-website`}>Website</Label>
                <Input
                  id={`${idBase}-website`}
                  value={data.website ?? ''}
                  onChange={(e) => update('website', e.target.value || null)}
                  placeholder="https://example.com"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${idBase}-address`}>Address</Label>
              <Textarea
                id={`${idBase}-address`}
                rows={2}
                value={data.address ?? ''}
                onChange={(e) => update('address', e.target.value || null)}
                placeholder="Street, City, Country"
              />
            </div>
          </section>
        )}

        {/* ── Legal ────────────────────────────────────────────────────────── */}
        {showInfo && (
          <section className="space-y-4">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              Legal
            </h3>
            <div className="space-y-1.5 max-w-sm">
              <Label htmlFor={`${idBase}-copyright`}>Copyright holder</Label>
              <Input
                id={`${idBase}-copyright`}
                value={data.copyrightHolder}
                onChange={(e) => update('copyrightHolder', e.target.value)}
                placeholder="Defaults to clinic name"
              />
            </div>
          </section>
        )}

        {/* ── Social ───────────────────────────────────────────────────────── */}
        {showInfo && (
          <section className="space-y-4">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              Social
            </h3>
            <div className="grid gap-3 md:grid-cols-2">
              {SOCIAL_FIELDS.map(({ key, label }) => (
                <div key={key} className="space-y-1">
                  <Label htmlFor={`${idBase}-${key}`} className="text-xs">
                    {label}
                  </Label>
                  <Input
                    id={`${idBase}-${key}`}
                    value={data.social[key] ?? ''}
                    onChange={(e) => updateSocial(key, e.target.value)}
                    placeholder="@yourhandle or full URL"
                  />
                </div>
              ))}
            </div>
          </section>
        )}

        <div className="flex items-center gap-2 pt-2 border-t">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : header.saveLabel}
          </Button>
          <p className="text-xs text-muted-foreground">Changes apply on the next page load.</p>
        </div>
      </CardContent>
    </Card>
  )
}
