import { format } from 'date-fns'
import { Camera, CheckCircle2, Trash2, Upload, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { uploadFile } from '@/lib/actions/upload'
import { api } from '@/lib/api-client'
import { useApiMutation, useApiQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query-keys'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { DeleteConfirmationDialog } from '@/shared/components/ui/delete-confirmation-dialog'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { Textarea } from '@/shared/components/ui/textarea'
import { formatAmount } from '@/shared/utils/currency'
import type { LabCase, LabCaseStatus } from '../types'
import { STATUS_LABELS, STATUS_VARIANT } from '../types'

interface Props {
  caseId: string
  onClose: () => void
  onChanged: () => void
}

export function LabCaseDetailDialog({ caseId, onClose, onChanged }: Props) {
  const [progressNote, setProgressNote] = useState('')
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [photoType, setPhotoType] = useState('prep')
  const [uploading, setUploading] = useState(false)
  const [deletePhotoId, setDeletePhotoId] = useState<string | null>(null)
  const [deleteCaseOpen, setDeleteCaseOpen] = useState(false)

  // Shares its cache entry with labs/pages/case-detail.tsx (the same case's
  // full-page view) — a change from either surface refreshes the other.
  const CASE_KEY = queryKeys.labs.caseDetail(caseId)
  const caseQuery = useApiQuery<LabCase>(CASE_KEY, () =>
    api.get<LabCase>(`/api/labs/cases/${caseId}`)
  )
  const labCase = caseQuery.data ?? null
  const loading = caseQuery.isLoading

  const transitionMutation = useApiMutation(
    (newStatus: LabCaseStatus) => api.patch(`/api/labs/cases/${caseId}`, { status: newStatus }),
    { invalidates: [CASE_KEY, queryKeys.labs.all] }
  )
  const saveNoteMutation = useApiMutation(
    (updatedNotes: string) => api.patch(`/api/labs/cases/${caseId}`, { notes: updatedNotes }),
    { invalidates: [CASE_KEY] }
  )
  const uploadPhotoMutation = useApiMutation(
    (vars: { photoUrl: string; photoType: string }) =>
      api.post(`/api/labs/cases/${caseId}/photos`, vars),
    { invalidates: [CASE_KEY] }
  )
  const deletePhotoMutation = useApiMutation(
    (photoId: string) => api.delete(`/api/labs/photos/${photoId}`),
    { invalidates: [CASE_KEY] }
  )
  const deleteCaseMutation = useApiMutation((id: string) => api.delete(`/api/labs/cases/${id}`), {
    invalidates: [queryKeys.labs.all],
  })

  async function transition(newStatus: LabCaseStatus) {
    try {
      await transitionMutation.mutateAsync(newStatus)
      toast.success(`Moved to ${STATUS_LABELS[newStatus]}`)
      onChanged()
    } catch {
      // matches original: no explicit error toast when the transition fails
    }
  }

  async function saveNote() {
    if (!progressNote.trim() || !labCase) return
    const existing = labCase.notes || ''
    const ts = format(new Date(), 'MMM d h:mm a')
    const updated = `${existing}${existing ? '\n\n' : ''}[${ts}] ${progressNote.trim()}`
    try {
      await saveNoteMutation.mutateAsync(updated)
      setProgressNote('')
    } catch {
      // matches original: no explicit error toast when the note save fails
    }
  }

  async function onFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !labCase) return
    setUploading(true)
    try {
      const up = await uploadFile(file, {
        folder: 'labs',
        subfolder: `${labCase.id}/photos`,
        profile: 'image',
      })
      if (!up.success || !up.url) {
        toast.error(up.error || 'Upload failed')
        return
      }
      await uploadPhotoMutation.mutateAsync({ photoUrl: up.url, photoType })
      toast.success('Photo uploaded')
    } catch {
      // matches original: no explicit error toast when the photo-save fails
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  async function confirmDeletePhoto() {
    if (!deletePhotoId) return
    await deletePhotoMutation.mutateAsync(deletePhotoId)
    toast.success('Photo deleted')
    setDeletePhotoId(null)
  }

  async function confirmDeleteCase() {
    await deleteCaseMutation.mutateAsync(caseId)
    toast.success('Case deleted')
    setDeleteCaseOpen(false)
    onChanged()
    onClose()
  }

  if (loading || !labCase) {
    return (
      <Dialog open={true} onOpenChange={() => onClose()}>
        <DialogContent className="max-w-2xl">
          <Skeleton className="h-40 w-full" />
        </DialogContent>
      </Dialog>
    )
  }

  const nextStatuses = getNextStatuses(labCase.status)

  return (
    <Dialog open={true} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <DialogTitle className="font-mono">{labCase.caseNumber}</DialogTitle>
              <div className="flex items-center gap-2 mt-1">
                <Badge variant={STATUS_VARIANT[labCase.status]} className="text-[10px]">
                  {STATUS_LABELS[labCase.status]}
                </Badge>
                {labCase.vendor && (
                  <Badge variant="outline" className="text-[10px] capitalize">
                    {labCase.vendor.type} — {labCase.vendor.name}
                  </Badge>
                )}
              </div>
            </div>
            <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Summary */}
          <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-2">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Patient</p>
                {labCase.patient ? (
                  <Link
                    to={`/patients/${labCase.patientId}`}
                    className="font-medium hover:underline"
                  >
                    {labCase.patient.name}
                  </Link>
                ) : (
                  '—'
                )}
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Service</p>
                <p className="font-medium">{labCase.serviceName}</p>
              </div>
              {labCase.units && labCase.units.length > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground">Units</p>
                  <p className="text-sm">{labCase.units.map((u) => u.label).join(', ')}</p>
                </div>
              )}
              {labCase.expectedReturn && (
                <div>
                  <p className="text-xs text-muted-foreground">Expected Return</p>
                  <p className="text-sm">
                    {(() => {
                      try {
                        return format(new Date(labCase.expectedReturn!), 'MMM d, yyyy')
                      } catch {
                        return labCase.expectedReturn
                      }
                    })()}
                  </p>
                </div>
              )}
              {labCase.cost != null && labCase.cost > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground">Cost</p>
                  <p className="text-sm font-medium">GHS {formatAmount(Number(labCase.cost))}</p>
                </div>
              )}
            </div>
          </div>

          {/* Status transitions */}
          {nextStatuses.length > 0 && (
            <div className="rounded-lg border border-border p-3 space-y-2">
              <p className="text-xs uppercase tracking-wide font-medium text-muted-foreground">
                Next Action
              </p>
              <div className="flex items-center gap-2 flex-wrap">
                {nextStatuses.map((s) => (
                  <Button key={s} size="sm" onClick={() => transition(s)}>
                    <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                    {STATUS_LABELS[s]}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {/* Photos */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">Photos</p>
              <div className="flex items-center gap-2">
                <Select value={photoType} onValueChange={setPhotoType}>
                  <SelectTrigger className="w-32 h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="prep">Prep</SelectItem>
                    <SelectItem value="shade">Shade</SelectItem>
                    <SelectItem value="impression">Impression</SelectItem>
                    <SelectItem value="final">Final</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={onFilePicked}
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                >
                  {uploading ? (
                    <Camera className="mr-1.5 h-3.5 w-3.5 animate-pulse" />
                  ) : (
                    <Upload className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  Upload
                </Button>
              </div>
            </div>
            {labCase.photos && labCase.photos.length > 0 ? (
              <div className="grid grid-cols-3 md:grid-cols-4 gap-2">
                {labCase.photos.map((p) => (
                  <div
                    key={p.id}
                    className="group relative aspect-square rounded-md border border-border overflow-hidden"
                  >
                    <img
                      src={p.photoUrl}
                      alt={p.photoType}
                      className="w-full h-full object-cover"
                    />
                    <Badge
                      variant="secondary"
                      className="absolute top-1 left-1 text-[9px] capitalize"
                    >
                      {p.photoType}
                    </Badge>
                    <button
                      type="button"
                      onClick={() => setDeletePhotoId(p.id)}
                      className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity bg-destructive text-destructive-foreground p-1 rounded text-xs"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground italic">
                No photos yet. Photos are optional.
              </p>
            )}
          </div>

          {/* Notes / progress log */}
          <div className="space-y-2">
            <p className="text-sm font-medium">Progress Notes (optional)</p>
            {labCase.notes && (
              <div className="rounded-md border border-border bg-muted/20 p-3 max-h-40 overflow-y-auto">
                <pre className="whitespace-pre-wrap text-xs font-sans">{labCase.notes}</pre>
              </div>
            )}
            <div className="flex gap-2">
              <Textarea
                value={progressNote}
                onChange={(e) => setProgressNote(e.target.value)}
                rows={2}
                placeholder="Add a progress note..."
                className="flex-1"
              />
              <Button size="sm" onClick={saveNote} disabled={!progressNote.trim()}>
                Add
              </Button>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => setDeleteCaseOpen(true)}
            className="text-destructive mr-auto"
          >
            <Trash2 className="mr-1.5 h-3.5 w-3.5" />
            Delete Case
          </Button>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>

      <DeleteConfirmationDialog
        open={!!deletePhotoId}
        onOpenChange={(o) => !o && setDeletePhotoId(null)}
        onConfirm={confirmDeletePhoto}
        title="Delete photo?"
        description="The photo will be removed from this lab case."
      />

      <DeleteConfirmationDialog
        open={deleteCaseOpen}
        onOpenChange={setDeleteCaseOpen}
        onConfirm={confirmDeleteCase}
        title="Delete lab case?"
        description="The case and all its progress notes will be permanently removed."
        itemName={labCase?.caseNumber}
      />
    </Dialog>
  )
}

function getNextStatuses(current: LabCaseStatus): LabCaseStatus[] {
  switch (current) {
    case 'draft':
      return ['sent', 'cancelled']
    case 'sent':
      return ['in_progress', 'received', 'cancelled']
    case 'in_progress':
      return ['received', 'cancelled']
    case 'received':
      return ['ready_for_insertion']
    case 'ready_for_insertion':
      return ['inserted']
    case 'inserted':
      return []
    case 'cancelled':
      return []
    default:
      return []
  }
}
