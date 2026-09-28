import { format } from 'date-fns'
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Loader2,
  Printer,
  Share2,
  Trash2,
  XOctagon,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { api } from '@/lib/api-client'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent } from '@/shared/components/ui/card'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select'
import { Skeleton } from '@/shared/components/ui/skeleton'

interface XrayRecord {
  id: string
  patientId: string
  xrayTypeId: string | null
  origin: string
  imageUrl: string
  capturedAt: string | null
  uploadedAt: string
  notes: string | null
  type?: { id: string; name: string; displayName: string } | null
  patient?: { id: string; name: string } | null
}

interface ShareLink {
  id: string
  xrayRecordIds: string[]
  patientId: string
  recipientName: string
  linkToken: string
  accessCode: string
  expiresAt: string
  revokedAt: string | null
  createdAt: string
}

function effectiveStatus(link: ShareLink): 'shared' | 'expired' | 'revoked' {
  if (link.revokedAt) return 'revoked'
  if (new Date(link.expiresAt) < new Date()) return 'expired'
  return 'shared'
}

export default function XrayDetailPage() {
  const { id = '' } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [record, setRecord] = useState<XrayRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [shareLinks, setShareLinks] = useState<ShareLink[]>([])
  const [imageIndex, setImageIndex] = useState(0)
  const [shareExpiryDays, setShareExpiryDays] = useState('7')
  const [recipientName, setRecipientName] = useState('')
  const [sharing, setSharing] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await api.get<XrayRecord>(`/api/xrays/${id}`)
    if (res.success && res.data) {
      setRecord(res.data)
      const linksRes = await api.get<ShareLink[]>(
        `/api/xrays/share-links/patient/${res.data.patientId}`
      )
      if (linksRes.success && linksRes.data) {
        setShareLinks(linksRes.data.filter((l) => l.xrayRecordIds.includes(id)))
      }
    }
    setLoading(false)
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  const activeLink = useMemo(
    () => shareLinks.find((l) => effectiveStatus(l) === 'shared') ?? null,
    [shareLinks]
  )
  const latestLink = useMemo(() => shareLinks[0] ?? null, [shareLinks])
  const status = activeLink ? 'shared' : latestLink ? effectiveStatus(latestLink) : 'none'

  const shareUrl = activeLink
    ? `${window.location.origin}/xray-share/${activeLink.linkToken}`
    : null

  const handleCreateShare = async () => {
    if (!record) return
    if (!recipientName.trim()) {
      toast.error('Enter a recipient name first')
      return
    }
    setSharing(true)
    const res = await api.post<{
      shareUrl: string
      accessCode: string
      expiresAt: string
      id: string
    }>('/api/xrays/share', {
      xrayRecordIds: [record.id],
      recipientName: recipientName.trim(),
      expiryDays: Number(shareExpiryDays) || 7,
    })
    setSharing(false)
    if (res.success) {
      toast.success('Shareable link created')
      load()
    } else {
      toast.error('Failed to create share link')
    }
  }

  const handleRevoke = async () => {
    if (!activeLink) return
    const res = await api.patch(`/api/xrays/share-links/${activeLink.id}/revoke`, {})
    if (res.success) {
      toast.success('Access revoked')
      load()
    } else {
      toast.error('Failed to revoke')
    }
  }

  const handleDelete = async () => {
    if (!record) return
    setDeleting(true)
    const res = await api.delete(`/api/xrays/${record.id}`)
    setDeleting(false)
    if (res.success) {
      toast.success('X-ray deleted')
      navigate('/xrays')
    } else {
      toast.error('Failed to delete')
    }
  }

  const copyToClipboard = (text: string, label: string) => {
    try {
      navigator.clipboard.writeText(text)
      toast.success(`${label} copied`)
    } catch {
      toast.error('Could not copy — please copy manually')
    }
  }

  if (loading) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-[400px] w-full rounded-lg" />
      </div>
    )
  }

  if (!record) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] gap-3 p-6 text-center">
        <p className="text-lg font-medium">X-ray not found</p>
        <p className="text-sm text-muted-foreground">The record may have been deleted.</p>
        <Button variant="outline" size="sm" onClick={() => navigate('/xrays')}>
          Back to X-rays
        </Button>
      </div>
    )
  }

  const images = record.imageUrl ? [record.imageUrl] : []
  const current = images[imageIndex] ?? null
  const takenDate = record.capturedAt || record.uploadedAt

  return (
    <div className="p-6 space-y-6">
      {/* Breadcrumb */}
      <nav aria-label="Breadcrumb" className="text-xs text-muted-foreground">
        <button
          type="button"
          className="hover:text-foreground hover:underline"
          onClick={() => navigate('/xrays')}
        >
          X-rays
        </button>
        <span className="mx-2">›</span>
        <span className="font-medium text-foreground">{record.patient?.name ?? '—'}</span>
      </nav>

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{record.type?.displayName ?? 'X-ray'}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Patient:{' '}
            <span className="font-medium text-foreground">{record.patient?.name ?? '—'}</span>
            {' • '}
            {format(new Date(takenDate), 'MMM d, yyyy · h:mm a')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            <Printer className="mr-1.5 h-3.5 w-3.5" />
            Print
          </Button>
          <Button variant="outline" size="sm" onClick={handleDelete} disabled={deleting}>
            {deleting ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="mr-1.5 h-3.5 w-3.5 text-destructive" />
            )}
            Delete
          </Button>
        </div>
      </div>

      {/* Image viewer */}
      <Card>
        <CardContent className="p-4">
          {current ? (
            <>
              <div className="flex items-center justify-center bg-black/5 rounded-lg overflow-hidden border border-border min-h-[400px]">
                <img
                  src={current}
                  alt={`${record.type?.displayName ?? 'X-ray'} for ${record.patient?.name ?? ''}`}
                  className="max-h-[60vh] w-auto object-contain"
                />
              </div>
              {images.length > 1 && (
                <div className="mt-3 flex items-center justify-between">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setImageIndex((i) => Math.max(0, i - 1))}
                    disabled={imageIndex === 0}
                  >
                    <ChevronLeft className="mr-1 h-4 w-4" />
                    Previous
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    {imageIndex + 1} / {images.length}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setImageIndex((i) => Math.min(images.length - 1, i + 1))}
                    disabled={imageIndex === images.length - 1}
                  >
                    Next
                    <ChevronRight className="ml-1 h-4 w-4" />
                  </Button>
                </div>
              )}
            </>
          ) : (
            <p className="py-20 text-center text-sm text-muted-foreground">No image attached.</p>
          )}
        </CardContent>
      </Card>

      {/* Notes */}
      {record.notes && (
        <Card>
          <CardContent className="p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">
              Notes
            </p>
            <p className="text-sm whitespace-pre-wrap">{record.notes}</p>
          </CardContent>
        </Card>
      )}

      {/* Sharing panel */}
      <Card>
        <CardContent className="p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold flex items-center gap-2">
                <Share2 className="h-4 w-4" />
                Sharing
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Generate a secure link + access code to share this X-ray with the patient or a
                specialist.
              </p>
            </div>
            <Badge
              variant={
                status === 'shared' ? 'default' : status === 'none' ? 'outline' : 'secondary'
              }
              className={status === 'shared' ? 'bg-emerald-600 hover:bg-emerald-600' : undefined}
            >
              {status === 'shared'
                ? 'Shared'
                : status === 'expired'
                  ? 'Expired'
                  : status === 'revoked'
                    ? 'Revoked'
                    : 'Not shared'}
            </Badge>
          </div>

          {status === 'none' && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Recipient name</Label>
                <Input
                  placeholder="e.g. Dr. Kofi Mensah"
                  value={recipientName}
                  onChange={(e) => setRecipientName(e.target.value)}
                />
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Expiry</p>
                  <Select value={shareExpiryDays} onValueChange={setShareExpiryDays}>
                    <SelectTrigger className="w-[140px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">24 hours</SelectItem>
                      <SelectItem value="7">7 days</SelectItem>
                      <SelectItem value="30">30 days</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button onClick={handleCreateShare} disabled={sharing}>
                  {sharing ? (
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                  ) : (
                    <Share2 className="mr-1.5 h-4 w-4" />
                  )}
                  Make shareable
                </Button>
              </div>
            </div>
          )}

          {status === 'shared' && activeLink && shareUrl && (
            <div className="space-y-3 rounded-md border border-border bg-muted/30 p-4">
              <div className="space-y-1">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Link
                </p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 truncate rounded bg-background px-2 py-1.5 font-mono text-xs">
                    {shareUrl}
                  </code>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => copyToClipboard(shareUrl, 'Link')}
                  >
                    <Copy className="mr-1 h-3.5 w-3.5" />
                    Copy
                  </Button>
                </div>
              </div>
              <div className="space-y-1">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Access code
                </p>
                <div className="flex items-center gap-2">
                  <code className="rounded bg-background px-3 py-1.5 font-mono text-base tracking-[0.25em]">
                    {activeLink.accessCode}
                  </code>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => copyToClipboard(activeLink.accessCode, 'Code')}
                  >
                    <Copy className="mr-1 h-3.5 w-3.5" />
                    Copy
                  </Button>
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>
                  Shared with {activeLink.recipientName} • Expires{' '}
                  {format(new Date(activeLink.expiresAt), 'MMM d, yyyy h:mm a')}
                </span>
                <Button variant="ghost" size="sm" onClick={handleRevoke}>
                  <XOctagon className="mr-1.5 h-3.5 w-3.5 text-destructive" />
                  Revoke access
                </Button>
              </div>
            </div>
          )}

          {(status === 'expired' || status === 'revoked') && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground rounded-md border border-border bg-muted/30 p-3">
                Previous share is {status}. Enter a recipient name and generate a new link.
              </p>
              <div className="space-y-1.5">
                <Label>Recipient name</Label>
                <Input
                  placeholder="e.g. Dr. Kofi Mensah"
                  value={recipientName}
                  onChange={(e) => setRecipientName(e.target.value)}
                />
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Expiry</p>
                  <Select value={shareExpiryDays} onValueChange={setShareExpiryDays}>
                    <SelectTrigger className="w-[140px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">24 hours</SelectItem>
                      <SelectItem value="7">7 days</SelectItem>
                      <SelectItem value="30">30 days</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button onClick={handleCreateShare} disabled={sharing}>
                  {sharing ? (
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                  ) : (
                    <Share2 className="mr-1.5 h-4 w-4" />
                  )}
                  Re-share
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
