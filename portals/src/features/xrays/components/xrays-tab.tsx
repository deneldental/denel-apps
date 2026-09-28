import { format } from 'date-fns'
import { Copy, ScanLine, Share2, Trash2, Upload, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { useToothNotation } from '@/features/clinical/use-clinical-preferences'
import { uploadFile } from '@/lib/actions/upload'
import { api } from '@/lib/api-client'
import { useApiMutation, useApiQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query-keys'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Checkbox } from '@/shared/components/ui/checkbox'
import { DeleteConfirmationDialog } from '@/shared/components/ui/delete-confirmation-dialog'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
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
import { Switch } from '@/shared/components/ui/switch'
import { Textarea } from '@/shared/components/ui/textarea'
import type { ShareCreateResponse, XrayRecord, XrayType } from '../types'

interface Props {
  patientId: string
  canEdit?: boolean
}

export function XraysTab({ patientId, canEdit = true }: Props) {
  const { toothLabel } = useToothNotation()
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [viewer, setViewer] = useState<XrayRecord | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)

  // Upload
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [xrayTypeId, setXrayTypeId] = useState<string>('')
  const [toothNumber, setToothNumber] = useState<string>('')
  const [isExternal, setIsExternal] = useState(false)
  const [externalClinic, setExternalClinic] = useState('')
  const [externalDate, setExternalDate] = useState('')
  const [notes, setNotes] = useState('')
  const [uploading, setUploading] = useState(false)

  // Share
  const [shareOpen, setShareOpen] = useState(false)
  const [shareRecipientName, setShareRecipientName] = useState('')
  const [shareExpiryDays, setShareExpiryDays] = useState('7')
  const [shareResult, setShareResult] = useState<ShareCreateResponse | null>(null)
  const [creatingShare, setCreatingShare] = useState(false)

  const patientXraysKey = queryKeys.xrays.patient(patientId)

  const recordsQuery = useApiQuery<XrayRecord[]>(patientXraysKey, () =>
    api.get<XrayRecord[]>(`/api/xrays/patient/${patientId}`)
  )
  const records = recordsQuery.data ?? []

  const typesQuery = useApiQuery<XrayType[]>(queryKeys.xrays.types(), () =>
    api.get<XrayType[]>('/api/xrays/types')
  )
  const types = typesQuery.data ?? []

  const loading = recordsQuery.isLoading || typesQuery.isLoading

  // Also invalidates the admin xrays list (queryKeys.xrays.list()'s filtered
  // variants all share that prefix), so a new/removed record shows up there too.
  const uploadMutation = useApiMutation((payload: any) => api.post('/api/xrays', payload), {
    invalidates: [patientXraysKey, queryKeys.xrays.list()],
  })
  const deleteMutation = useApiMutation((id: string) => api.delete(`/api/xrays/${id}`), {
    invalidates: [patientXraysKey, queryKeys.xrays.list()],
  })

  function onFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setSelectedFile(file)
    setUploadOpen(true)
    e.target.value = ''
  }

  async function handleUpload() {
    if (!selectedFile) return
    setUploading(true)
    try {
      const up = await uploadFile(selectedFile, {
        folder: 'xrays',
        subfolder: patientId,
        profile: 'image',
      })
      if (!up.success || !up.url) {
        toast.error(up.error || 'Upload failed')
        return
      }
      const payload: any = {
        patientId,
        xrayTypeId: xrayTypeId || null,
        origin: isExternal ? 'external' : 'internal',
        toothNumber: toothNumber ? parseInt(toothNumber, 10) : null,
        imageUrl: up.url,
        capturedAt: new Date().toISOString(),
        notes: notes || null,
      }
      if (isExternal) {
        payload.externalClinicName = externalClinic || null
        payload.externalCapturedDate = externalDate || null
      }
      try {
        await uploadMutation.mutateAsync(payload)
        toast.success('X-ray uploaded')
        setUploadOpen(false)
        setSelectedFile(null)
        setXrayTypeId('')
        setToothNumber('')
        setIsExternal(false)
        setExternalClinic('')
        setExternalDate('')
        setNotes('')
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed')
      }
    } finally {
      setUploading(false)
    }
  }

  async function confirmDelete() {
    if (!deleteId) return
    await deleteMutation.mutateAsync(deleteId)
    toast.success('Deleted')
    setDeleteId(null)
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  async function createShare() {
    if (!shareRecipientName.trim()) {
      toast.error('Recipient name required')
      return
    }
    if (selectedIds.size === 0) {
      toast.error('Select at least one X-ray')
      return
    }
    setCreatingShare(true)
    const res = await api.post<ShareCreateResponse>('/api/xrays/share', {
      xrayRecordIds: Array.from(selectedIds),
      recipientName: shareRecipientName.trim(),
      expiryDays: parseInt(shareExpiryDays, 10) || 7,
    })
    setCreatingShare(false)
    if (res.success && res.data) {
      setShareResult(res.data)
      toast.success('Share link ready')
    } else {
      toast.error((res.error as string) || 'Failed')
    }
  }

  function closeShare() {
    setShareOpen(false)
    setShareRecipientName('')
    setShareResult(null)
    setSelectedIds(new Set())
  }

  if (loading) {
    return (
      <div className="grid grid-cols-3 md:grid-cols-4 gap-3">
        {[...Array(4)].map((_, i) => (
          <Skeleton key={i} className="aspect-square rounded-lg" />
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="text-lg font-semibold">X-rays</h3>
          <p className="text-xs text-muted-foreground">Internal + external X-ray records.</p>
        </div>
        <div className="flex items-center gap-2">
          {selectedIds.size > 0 && canEdit && (
            <Button size="sm" variant="outline" onClick={() => setShareOpen(true)}>
              <Share2 className="mr-1.5 h-3.5 w-3.5" />
              Share ({selectedIds.size})
            </Button>
          )}
          {canEdit && (
            <>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={onFilePicked}
              />
              <Button size="sm" onClick={() => fileRef.current?.click()}>
                <Upload className="mr-1.5 h-3.5 w-3.5" />
                Upload X-ray
              </Button>
            </>
          )}
        </div>
      </div>

      {records.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border py-12 text-center">
          <ScanLine className="h-8 w-8 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">No X-rays uploaded yet.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {records.map((r) => (
            <div
              key={r.id}
              className="group relative aspect-square rounded-lg border border-border bg-muted/20 overflow-hidden cursor-pointer"
            >
              <img
                src={r.thumbnailUrl || r.imageUrl}
                alt={r.type?.displayName || 'X-ray'}
                className="w-full h-full object-cover"
                onClick={() => setViewer(r)}
              />
              {canEdit && (
                <div className="absolute top-1.5 left-1.5" onClick={(e) => e.stopPropagation()}>
                  <Checkbox
                    checked={selectedIds.has(r.id)}
                    onCheckedChange={() => toggleSelect(r.id)}
                    className="bg-background/80"
                  />
                </div>
              )}
              <div className="absolute top-1.5 right-1.5 flex flex-col gap-1">
                {r.origin === 'external' && (
                  <Badge variant="secondary" className="text-[9px]">
                    External
                  </Badge>
                )}
                {r.type && (
                  <Badge variant="default" className="text-[9px]">
                    {r.type.displayName}
                  </Badge>
                )}
              </div>
              {canEdit && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    setDeleteId(r.id)
                  }}
                  className="absolute bottom-1.5 right-1.5 opacity-0 group-hover:opacity-100 transition-opacity bg-destructive text-destructive-foreground p-1.5 rounded"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              )}
              <div className="absolute bottom-0 left-0 right-0 px-2 py-1 bg-gradient-to-t from-black/70 to-transparent">
                <p className="text-[10px] text-white">
                  {r.toothNumber ? `#${toothLabel(r.toothNumber)} · ` : ''}
                  {(() => {
                    try {
                      return format(new Date(r.uploadedAt), 'MMM d, yyyy')
                    } catch {
                      return ''
                    }
                  })()}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Upload dialog */}
      <Dialog open={uploadOpen} onOpenChange={(o) => !o && setUploadOpen(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Upload X-ray</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {selectedFile && (
              <div className="rounded-md border border-border px-3 py-2 flex items-center gap-2">
                <ScanLine className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="text-sm truncate flex-1">{selectedFile.name}</span>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Type</Label>
                <Select value={xrayTypeId} onValueChange={setXrayTypeId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    {types
                      .filter((t) => t.active)
                      .map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.displayName}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Tooth (optional, FDI number)</Label>
                <Input
                  value={toothNumber}
                  onChange={(e) => setToothNumber(e.target.value)}
                  placeholder="e.g. 14"
                />
              </div>
            </div>

            <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
              <div>
                <p className="text-sm font-medium">External source</p>
                <p className="text-xs text-muted-foreground">Patient brought from another clinic</p>
              </div>
              <Switch checked={isExternal} onCheckedChange={setIsExternal} />
            </div>

            {isExternal && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Clinic Name</Label>
                  <Input
                    value={externalClinic}
                    onChange={(e) => setExternalClinic(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Captured Date</Label>
                  <Input
                    type="date"
                    value={externalDate}
                    onChange={(e) => setExternalDate(e.target.value)}
                  />
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <Label>Notes (optional)</Label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUploadOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleUpload} disabled={uploading || !selectedFile}>
              {uploading ? 'Uploading…' : 'Upload'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Viewer */}
      <Dialog open={!!viewer} onOpenChange={(o) => !o && setViewer(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <div className="flex items-center justify-between">
              <DialogTitle>
                {viewer?.type?.displayName || 'X-ray'}
                {viewer?.toothNumber != null && ` — Tooth ${toothLabel(viewer.toothNumber)}`}
              </DialogTitle>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setViewer(null)}
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </DialogHeader>
          {viewer && (
            <div className="space-y-3">
              <img
                src={viewer.imageUrl}
                alt=""
                className="max-h-[75vh] w-full object-contain rounded-md border border-border bg-black"
              />
              {viewer.origin === 'external' && viewer.externalClinicName && (
                <p className="text-xs text-muted-foreground">
                  Source: {viewer.externalClinicName}
                  {viewer.externalCapturedDate &&
                    ` · ${format(new Date(viewer.externalCapturedDate), 'MMM d, yyyy')}`}
                </p>
              )}
              {viewer.notes && <p className="text-sm">{viewer.notes}</p>}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Share dialog */}
      <Dialog open={shareOpen} onOpenChange={(o) => !o && closeShare()}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Share X-rays externally</DialogTitle>
          </DialogHeader>

          {!shareResult ? (
            <>
              <div className="space-y-3 py-2">
                <div className="rounded-md bg-muted/30 border border-border px-3 py-2 text-sm">
                  <strong>{selectedIds.size}</strong> X-ray(s) selected
                </div>
                <div className="space-y-1.5">
                  <Label>Recipient name (e.g. Dr. Smith)</Label>
                  <Input
                    value={shareRecipientName}
                    onChange={(e) => setShareRecipientName(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Expires in (days, 1–30)</Label>
                  <Input
                    type="number"
                    min={1}
                    max={30}
                    value={shareExpiryDays}
                    onChange={(e) => setShareExpiryDays(e.target.value)}
                  />
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  A secure link + 6-digit code will be generated. Send them to the recipient via the
                  clinic WhatsApp account manually. The recipient must enter the code to view the
                  X-rays. All access is logged.
                </p>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={closeShare}>
                  Cancel
                </Button>
                <Button
                  onClick={createShare}
                  disabled={creatingShare || !shareRecipientName.trim()}
                >
                  {creatingShare ? 'Creating…' : 'Create Share Link'}
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <div className="space-y-3 py-2">
                <div className="rounded-md border border-border p-3 space-y-2">
                  <Label className="text-xs">Share URL</Label>
                  <div className="flex items-center gap-2">
                    <Input readOnly value={shareResult.shareUrl} className="font-mono text-xs" />
                    <Button
                      size="icon"
                      variant="outline"
                      onClick={() => {
                        navigator.clipboard.writeText(shareResult.shareUrl)
                        toast.success('URL copied')
                      }}
                      aria-label="Copy"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>

                <div className="rounded-md border border-border p-3 space-y-2">
                  <Label className="text-xs">Access code (send separately)</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      readOnly
                      value={shareResult.accessCode}
                      className="font-mono text-lg tracking-widest text-center"
                    />
                    <Button
                      size="icon"
                      variant="outline"
                      onClick={() => {
                        navigator.clipboard.writeText(shareResult.accessCode)
                        toast.success('Code copied')
                      }}
                      aria-label="Copy"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>

                <div className="rounded-md border border-border p-3 space-y-2">
                  <Label className="text-xs">Pre-formatted WhatsApp message</Label>
                  <Textarea
                    readOnly
                    value={shareResult.preformattedMessage}
                    rows={6}
                    className="font-mono text-xs"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      navigator.clipboard.writeText(shareResult.preformattedMessage)
                      toast.success('Message copied')
                    }}
                    className="w-full"
                  >
                    <Copy className="mr-1.5 h-3.5 w-3.5" />
                    Copy Message
                  </Button>
                </div>

                <p className="text-xs text-muted-foreground">
                  Now open the clinic's WhatsApp, paste the message to the recipient, and send.
                  Expires {(() => {
                    try {
                      return format(new Date(shareResult.expiresAt), 'MMM d, yyyy')
                    } catch {
                      return ''
                    }
                  })()}.
                </p>
              </div>
              <DialogFooter>
                <Button onClick={closeShare}>Done</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <DeleteConfirmationDialog
        open={!!deleteId}
        onOpenChange={(o) => !o && setDeleteId(null)}
        onConfirm={confirmDelete}
        title="Delete X-ray?"
        description="The X-ray will be permanently removed from this patient's record."
      />
    </div>
  )
}
