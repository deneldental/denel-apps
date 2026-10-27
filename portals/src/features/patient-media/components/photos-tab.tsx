import { format } from 'date-fns'
import { Image as ImageIcon, Trash2, Upload, X } from 'lucide-react'
import { useRef, useState } from 'react'
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
import { Label } from '@/shared/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { Textarea } from '@/shared/components/ui/textarea'
import { type PatientPhoto, PHOTO_CATEGORY_LABELS, type PhotoCategory } from '../types'

interface PhotosTabProps {
  patientId: string
  canEdit?: boolean
}

export function PhotosTab({ patientId, canEdit = true }: PhotosTabProps) {
  const [viewerPhoto, setViewerPhoto] = useState<PatientPhoto | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<PatientPhoto | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Upload state
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [category, setCategory] = useState<PhotoCategory>('intraoral')
  const [notes, setNotes] = useState('')
  const [uploading, setUploading] = useState(false)

  const photosKey = queryKeys.patientMedia.photos(patientId)
  const photosQuery = useApiQuery<PatientPhoto[]>(photosKey, () =>
    api.get<PatientPhoto[]>(`/api/patient-media/photos/patient/${patientId}`)
  )
  const photos = photosQuery.data ?? []
  const loading = photosQuery.isLoading

  const savePhotoMutation = useApiMutation(
    (vars: {
      patientId: string
      category: PhotoCategory
      clinicalScope: boolean
      imageUrl: string
      notes: string | null
    }) => api.post('/api/patient-media/photos', vars),
    { invalidates: [photosKey] }
  )
  const deletePhotoMutation = useApiMutation(
    (id: string) => api.delete(`/api/patient-media/photos/${id}`),
    { invalidates: [photosKey] }
  )

  function onFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setSelectedFile(file)
    setUploadDialogOpen(true)
    // reset so picking same file again triggers
    e.target.value = ''
  }

  async function handleUpload() {
    if (!selectedFile) return
    setUploading(true)
    try {
      const uploadRes = await uploadFile(selectedFile, {
        storageCategory: 'patient_records',
        folder: 'patients',
        subfolder: `${patientId}/photos`,
        profile: 'image',
      })
      if (!uploadRes.success || !uploadRes.url) {
        toast.error(uploadRes.error || 'Upload failed')
        return
      }

      const clinicalScope = category !== 'portrait'
      try {
        await savePhotoMutation.mutateAsync({
          patientId,
          category,
          clinicalScope,
          imageUrl: uploadRes.url,
          notes: notes || null,
        })
        toast.success('Photo uploaded')
        setUploadDialogOpen(false)
        setSelectedFile(null)
        setNotes('')
        setCategory('intraoral')
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to save photo')
      }
    } finally {
      setUploading(false)
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await deletePhotoMutation.mutateAsync(deleteTarget.id)
      toast.success('Photo deleted')
      setDeleteTarget(null)
    } catch {
      toast.error('Failed to delete')
    } finally {
      setDeleting(false)
    }
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
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Photos</h3>
          <p className="text-xs text-muted-foreground">Intraoral, portrait, before/after images.</p>
        </div>
        {canEdit && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={onFilePicked}
            />
            <Button size="sm" onClick={() => fileInputRef.current?.click()}>
              <Upload className="mr-1.5 h-3.5 w-3.5" />
              Upload Photo
            </Button>
          </>
        )}
      </div>

      {photos.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border py-12 text-center">
          <ImageIcon className="h-8 w-8 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">No photos uploaded yet.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {photos.map((photo) => (
            <div
              key={photo.id}
              className="group relative aspect-square rounded-lg border border-border bg-muted/20 overflow-hidden cursor-pointer"
              onClick={() => setViewerPhoto(photo)}
            >
              <img
                src={photo.thumbnailUrl || photo.imageUrl}
                alt={PHOTO_CATEGORY_LABELS[photo.category]}
                className="w-full h-full object-cover"
              />
              <div className="absolute top-1.5 left-1.5">
                <Badge variant="secondary" className="text-[10px] h-5">
                  {PHOTO_CATEGORY_LABELS[photo.category]}
                </Badge>
              </div>
              {canEdit && (
                <button
                  type="button"
                  className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 transition-opacity rounded-full bg-destructive text-destructive-foreground p-1.5 text-xs"
                  onClick={(e) => {
                    e.stopPropagation()
                    setDeleteTarget(photo)
                  }}
                  aria-label="Delete"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              )}
              <div className="absolute bottom-0 left-0 right-0 px-1.5 py-1 bg-gradient-to-t from-black/70 to-transparent">
                <p className="text-[10px] text-white">
                  {(() => {
                    try {
                      return format(new Date(photo.uploadedAt), 'MMM d, yyyy')
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
      <Dialog open={uploadDialogOpen} onOpenChange={(o) => !o && setUploadDialogOpen(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Upload Photo</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {selectedFile && (
              <div className="rounded-md border border-border px-3 py-2 flex items-center gap-2">
                <ImageIcon className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="text-sm truncate flex-1">{selectedFile.name}</span>
                <span className="text-xs text-muted-foreground">
                  {(selectedFile.size / 1024).toFixed(0)} KB
                </span>
              </div>
            )}

            <div className="space-y-1.5">
              <Label>Category</Label>
              <Select value={category} onValueChange={(v) => setCategory(v as PhotoCategory)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="intraoral">Intraoral</SelectItem>
                  <SelectItem value="portrait">Portrait (non-clinical)</SelectItem>
                  <SelectItem value="before">Before</SelectItem>
                  <SelectItem value="after">After</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Notes (optional)</Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Tooth, procedure, date info..."
                rows={2}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setUploadDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleUpload} disabled={uploading || !selectedFile}>
              {uploading ? 'Uploading…' : 'Upload'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Viewer */}
      <Dialog open={!!viewerPhoto} onOpenChange={(o) => !o && setViewerPhoto(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <div className="flex items-center justify-between gap-3">
              <DialogTitle className="capitalize">
                {viewerPhoto ? PHOTO_CATEGORY_LABELS[viewerPhoto.category] : ''} Photo
              </DialogTitle>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setViewerPhoto(null)}
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </DialogHeader>
          {viewerPhoto && (
            <div className="space-y-3">
              <img
                src={viewerPhoto.imageUrl}
                alt=""
                className="max-h-[70vh] w-full object-contain rounded-md border border-border"
              />
              {viewerPhoto.notes && (
                <p className="text-sm text-muted-foreground">{viewerPhoto.notes}</p>
              )}
              <p className="text-xs text-muted-foreground">
                Uploaded {(() => {
                  try {
                    return format(new Date(viewerPhoto.uploadedAt), 'MMM d, yyyy h:mm a')
                  } catch {
                    return viewerPhoto.uploadedAt
                  }
                })()}
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <DeleteConfirmationDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
        onConfirm={confirmDelete}
        isLoading={deleting}
        title="Delete photo"
        description="This action cannot be undone."
        itemName={
          deleteTarget
            ? (PHOTO_CATEGORY_LABELS[deleteTarget.category as PhotoCategory] ?? 'this photo')
            : undefined
        }
      />
    </div>
  )
}
