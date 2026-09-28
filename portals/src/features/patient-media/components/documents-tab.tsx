// Unified media tab — documents + photos + x-rays rendered in a single table
// with a pill-based filter row. Photos and X-rays keep their own backend
// endpoints (no data migration); only the frontend merges the three sources.
//
//   - Documents:  GET /api/patient-media/documents/patient/:patientId
//   - Photos:     GET /api/patient-media/photos/patient/:patientId
//   - X-rays:     GET /api/xrays/patient/:patientId
//
// The upload composer on this tab is document-only in v1. Photo/X-ray
// uploads stay in their own specialized flows (handled by the Examination
// layer elsewhere in the app).

import { format, formatDistanceToNow } from 'date-fns'
import {
  ChevronRight,
  Download,
  ExternalLink,
  Eye,
  FileText,
  Image as ImageIcon,
  MoreVertical,
  ScanLine,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useToothNotation } from '@/features/clinical/use-clinical-preferences'
import type { XrayRecord } from '@/features/xrays/types'
import { uploadFile } from '@/lib/actions/upload'
import { api } from '@/lib/api-client'
import { useApiMutation, useApiQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query-keys'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { DeleteConfirmationDialog } from '@/shared/components/ui/delete-confirmation-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/shared/components/ui/dropdown-menu'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/shared/components/ui/sheet'
import { Skeleton } from '@/shared/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table'
import { useStableFileUrl } from '@/shared/hooks/use-stable-file-url'
import { useSubmitGuard } from '@/shared/hooks/use-submit-guard'
import { apiErrorMessage } from '@/shared/lib/api-error'
import {
  DOC_CATEGORY_LABELS,
  type DocumentCategory,
  type PatientDocument,
  type PatientPhoto,
  PHOTO_CATEGORY_LABELS,
  type PhotoCategory,
} from '../types'

interface DocumentsTabProps {
  patientId: string
  canEdit?: boolean
}

// Unified table item — discriminated union by `mediaType`.
type MediaItem =
  | { mediaType: 'document'; id: string; uploadedAt: string; source: PatientDocument }
  | {
      mediaType: 'photo'
      id: string
      uploadedAt: string
      category: PhotoCategory
      source: PatientPhoto
    }
  | { mediaType: 'xray'; id: string; uploadedAt: string; source: XrayRecord }

type FilterValue = 'all' | 'document' | 'photo' | 'xray'

type DocumentTagColor = 'slate' | 'blue' | 'green' | 'yellow' | 'red' | 'purple' | 'pink' | 'cyan'

// Mirrors the map in document-tags-section.tsx. Extract to a shared util
// if a third consumer appears.
// Two-variant pill styling — unselected uses light bg + dark text, selected
// flips to dark bg + light text of the same color family for strong contrast.
const TAG_COLOR_CLASSES: Record<DocumentTagColor, { base: string; selected: string }> = {
  slate: { base: 'bg-slate-100 text-foreground', selected: 'bg-slate-700 text-slate-50' },
  blue: { base: 'bg-blue-100 text-blue-700', selected: 'bg-blue-700 text-blue-50' },
  green: { base: 'bg-green-100 text-green-700', selected: 'bg-green-700 text-green-50' },
  yellow: { base: 'bg-yellow-100 text-yellow-700', selected: 'bg-yellow-700 text-yellow-50' },
  red: { base: 'bg-red-100 text-red-700', selected: 'bg-red-700 text-red-50' },
  purple: { base: 'bg-purple-100 text-purple-700', selected: 'bg-purple-700 text-purple-50' },
  pink: { base: 'bg-pink-100 text-pink-700', selected: 'bg-pink-700 text-pink-50' },
  cyan: { base: 'bg-cyan-100 text-cyan-700', selected: 'bg-cyan-700 text-cyan-50' },
}

const ACCEPTED_FILE_TYPES = '.pdf,.jpg,.jpeg,.png,.doc,.docx,.webp'

// Filter row pills — a light tag-shaped synthetic set for the filter header.
// Uses the same TagPill component as the upload composer for visual parity.
const FILTER_PILLS: Array<{
  id: FilterValue
  displayName: string
  color: DocumentTagColor
}> = [
  { id: 'all', displayName: 'All', color: 'slate' },
  { id: 'document', displayName: 'Documents', color: 'slate' },
  { id: 'photo', displayName: 'Photos', color: 'blue' },
  { id: 'xray', displayName: 'X-rays', color: 'purple' },
]

const MEDIA_TYPE_COLOR: Record<MediaItem['mediaType'], DocumentTagColor> = {
  document: 'slate',
  photo: 'blue',
  xray: 'purple',
}

const MEDIA_TYPE_LABEL: Record<MediaItem['mediaType'], string> = {
  document: 'Document',
  photo: 'Photo',
  xray: 'X-ray',
}

function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes <= 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const value = bytes / 1024 ** i
  const rounded = value >= 10 || i === 0 ? Math.round(value) : Math.round(value * 10) / 10
  return `${rounded} ${units[i]}`
}

function relativeTime(iso: string): string {
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true })
  } catch {
    return iso
  }
}

// Shared pill component — used for both the filter row and the upload-composer
// tag picker. `selected` drives the visual active state; callers decide
// whether the semantics are radio-style (filter) or checkbox-style (tags).
function TagPill({
  tag,
  selected,
  onClick,
  className,
}: {
  tag: { id: string; displayName: string; color: string }
  selected?: boolean
  onClick?: () => void
  className?: string
}) {
  const colorKey =
    (tag.color as DocumentTagColor) in TAG_COLOR_CLASSES ? (tag.color as DocumentTagColor) : 'slate'
  const variant = selected ? TAG_COLOR_CLASSES[colorKey].selected : TAG_COLOR_CLASSES[colorKey].base
  const base = `inline-flex items-center shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${variant}`
  if (!onClick) {
    return <span className={`${base} ${className ?? ''}`}>{tag.displayName}</span>
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${base} transition-colors ${!selected ? 'hover:brightness-95' : ''} ${className ?? ''}`}
    >
      {tag.displayName}
    </button>
  )
}

export function DocumentsTab({ patientId, canEdit = true }: DocumentsTabProps) {
  const { toothLabel } = useToothNotation()
  const [filter, setFilter] = useState<FilterValue>('all')

  // Upload composer state (document-only for v1).
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [notes, setNotes] = useState('')
  const [docCategory, setDocCategory] = useState<DocumentCategory>('other')
  const [isDragOver, setIsDragOver] = useState(false)
  const { isSubmitting: uploading, submit: submitUpload } = useSubmitGuard()

  // Viewers
  // The open document is remembered by id and read from the current list, so its
  // buttons use the latest link (links are re-signed and expire after an hour).
  const [viewerDocId, setViewerDocId] = useState<string | null>(null)
  const [viewerPhoto, setViewerPhoto] = useState<PatientPhoto | null>(null)
  const [viewerXray, setViewerXray] = useState<XrayRecord | null>(null)

  // Delete confirmation (discriminated so we hit the correct endpoint).
  const [deleteTarget, setDeleteTarget] = useState<MediaItem | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  // Documents are this file's own; photos/x-rays share their cache entry with
  // PhotosTab / XraysTab, so an upload or delete from either place refreshes
  // this merged view too.
  const documentsKey = queryKeys.patientMedia.documents(patientId)
  const photosKey = queryKeys.patientMedia.photos(patientId)
  const xraysKey = queryKeys.xrays.patient(patientId)

  const documentsQuery = useApiQuery<PatientDocument[]>(documentsKey, () =>
    api.get<PatientDocument[]>(`/api/patient-media/documents/patient/${patientId}`)
  )
  const photosQuery = useApiQuery<PatientPhoto[]>(photosKey, () =>
    api.get<PatientPhoto[]>(`/api/patient-media/photos/patient/${patientId}`)
  )
  const xraysQuery = useApiQuery<XrayRecord[]>(xraysKey, () =>
    api.get<XrayRecord[]>(`/api/xrays/patient/${patientId}`)
  )
  const documents = documentsQuery.data ?? []
  const viewerDoc = viewerDocId ? (documents.find((d) => d.id === viewerDocId) ?? null) : null
  const photos = photosQuery.data ?? []
  const xrays = xraysQuery.data ?? []
  const loading = documentsQuery.isLoading || photosQuery.isLoading || xraysQuery.isLoading

  useEffect(() => {
    if (documentsQuery.isError || photosQuery.isError || xraysQuery.isError) {
      toast.error('Failed to load some media — please refresh')
    }
  }, [documentsQuery.isError, photosQuery.isError, xraysQuery.isError])

  const uploadDocumentMutation = useApiMutation(
    async (payload: Record<string, unknown>) => {
      const res = await api.post('/api/patient-media/documents', payload)
      if (!res.success) throw new Error(apiErrorMessage(res, 'Failed to save document'))
      return res
    },
    { invalidates: [documentsKey] }
  )

  const deleteMediaMutation = useApiMutation(
    async (item: MediaItem) => {
      const endpointByType: Record<MediaItem['mediaType'], string> = {
        document: `/api/patient-media/documents/${item.id}`,
        photo: `/api/patient-media/photos/${item.id}`,
        xray: `/api/xrays/${item.id}`,
      }
      const res = await api.delete(endpointByType[item.mediaType])
      if (!res.success) throw new Error(apiErrorMessage(res, 'Failed to delete'))
      return res
    },
    {
      invalidates: (_data, item) => {
        if (item.mediaType === 'document') return [documentsKey]
        if (item.mediaType === 'photo') return [photosKey]
        return [xraysKey, queryKeys.xrays.list()]
      },
    }
  )

  // Merge the three sources into one list, sorted newest → oldest.
  const items = useMemo<MediaItem[]>(() => {
    const merged: MediaItem[] = [
      ...documents.map<MediaItem>((d) => ({
        mediaType: 'document' as const,
        id: d.id,
        uploadedAt: d.uploadedAt,
        source: d,
      })),
      ...photos.map<MediaItem>((p) => ({
        mediaType: 'photo' as const,
        id: p.id,
        uploadedAt: p.uploadedAt,
        category: p.category,
        source: p,
      })),
      ...xrays.map<MediaItem>((x) => ({
        mediaType: 'xray' as const,
        id: x.id,
        uploadedAt: x.uploadedAt,
        source: x,
      })),
    ]
    merged.sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime())
    return merged
  }, [documents, photos, xrays])

  const visible = useMemo(() => {
    if (filter === 'all') return items
    return items.filter((i) => i.mediaType === filter)
  }, [items, filter])

  // ── Composer handlers ──────────────────────────────────────────────────────

  function onFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null
    pickFile(file)
    // Allow re-picking the same file later.
    e.target.value = ''
  }

  function onDrop(e: React.DragEvent<HTMLLabelElement>) {
    e.preventDefault()
    setIsDragOver(false)
    const file = e.dataTransfer.files?.[0] ?? null
    pickFile(file)
  }

  function onDragOver(e: React.DragEvent<HTMLLabelElement>) {
    e.preventDefault()
    if (!isDragOver) setIsDragOver(true)
  }

  function onDragLeave(e: React.DragEvent<HTMLLabelElement>) {
    e.preventDefault()
    setIsDragOver(false)
  }

  const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024 // 20 MB

  function pickFile(file: File | null) {
    if (!file) return
    const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
    const allowedExts = ['pdf', 'jpg', 'jpeg', 'png', 'doc', 'docx', 'webp']
    if (!allowedExts.includes(ext)) {
      toast.error(`File type .${ext} is not allowed. Use PDF, JPG, PNG, DOC, DOCX, or WEBP.`)
      return
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      toast.error('File exceeds the 20 MB limit. Please choose a smaller file.')
      return
    }
    setSelectedFile(file)
  }

  function clearComposer() {
    setSelectedFile(null)
    setNotes('')
    setDocCategory('other')
  }

  async function handleUpload() {
    if (!selectedFile) {
      toast.error('Please choose a file to upload')
      return
    }
    await submitUpload(async () => {
      const up = await uploadFile(selectedFile, {
        storageCategory: 'patient_records',
        folder: 'patients',
        subfolder: `${patientId}/documents`,
        profile: 'imageOrPdf',
      })
      if (!up.success || !up.url) {
        toast.error(typeof up.error === 'string' ? up.error : 'Upload failed')
        return
      }
      try {
        await uploadDocumentMutation.mutateAsync({
          patientId,
          category: docCategory,
          fileName: selectedFile.name,
          fileUrl: up.url,
          fileSize: selectedFile.size,
          mimeType: selectedFile.type || null,
          notes: notes.trim() || null,
        })
        toast.success('Document uploaded')
        clearComposer()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to save document')
      }
    })
  }

  async function handleDeleteConfirmed() {
    if (!deleteTarget || isDeleting) return
    setIsDeleting(true)
    try {
      await deleteMediaMutation.mutateAsync(deleteTarget)
      toast.success('Deleted')
      setDeleteTarget(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete')
    } finally {
      setIsDeleting(false)
    }
  }

  function openItem(item: MediaItem) {
    if (item.mediaType === 'document') setViewerDocId(item.source.id)
    else if (item.mediaType === 'photo') setViewerPhoto(item.source)
    else setViewerXray(item.source)
  }

  function fileUrlFor(item: MediaItem): string {
    if (item.mediaType === 'document') return item.source.fileUrl
    if (item.mediaType === 'photo') return item.source.imageUrl
    return item.source.imageUrl
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Upload composer (document-only in v1) */}
      {canEdit && (
        <Card>
          <CardHeader>
            <CardTitle>Upload Document</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* 1 — Dropzone */}
            <label
              htmlFor="patient-doc-file"
              onDrop={onDrop}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              className={`flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-10 text-center transition-colors cursor-pointer ${
                isDragOver
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:border-muted-foreground/50'
              }`}
            >
              <input
                id="patient-doc-file"
                ref={fileInputRef}
                type="file"
                accept={ACCEPTED_FILE_TYPES}
                className="hidden"
                onChange={onFileInputChange}
              />

              {selectedFile ? (
                <div className="flex items-center gap-3 rounded-md border border-border bg-background px-3 py-2 max-w-full">
                  <FileText className="h-5 w-5 text-muted-foreground shrink-0" />
                  <div className="min-w-0 text-left">
                    <p className="text-sm font-medium truncate">{selectedFile.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatBytes(selectedFile.size)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      setSelectedFile(null)
                    }}
                    className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
                    aria-label="Remove selected file"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : (
                <>
                  <Upload className="h-7 w-7 text-muted-foreground/60" />
                  <div className="space-y-0.5">
                    <p className="text-sm font-medium">Drag & drop a file here</p>
                    <p className="text-xs text-muted-foreground">
                      or click to browse — PDF, JPG, PNG, DOC, DOCX
                    </p>
                  </div>
                </>
              )}
            </label>

            {/* 2 — Category */}
            <div className="space-y-1.5">
              <Label htmlFor="patient-doc-category">Category</Label>
              <Select
                value={docCategory}
                onValueChange={(v) => setDocCategory(v as DocumentCategory)}
              >
                <SelectTrigger id="patient-doc-category">
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {(Object.entries(DOC_CATEGORY_LABELS) as [DocumentCategory, string][]).map(
                    ([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    )
                  )}
                </SelectContent>
              </Select>
            </div>

            {/* 3 — Notes (optional) */}
            <div className="space-y-1.5">
              <Label htmlFor="patient-doc-notes">
                Notes <span className="text-muted-foreground text-xs font-normal">(optional)</span>
              </Label>
              <Input
                id="patient-doc-notes"
                placeholder="e.g. Panoramic X-ray taken 2025-01, Insurance Card front"
                value={notes}
                maxLength={500}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>

            {/* Submit */}
            <div className="flex justify-end pt-1">
              <Button onClick={handleUpload} disabled={uploading || !selectedFile}>
                <Upload className="mr-1.5 h-4 w-4" />
                {uploading ? 'Uploading…' : 'Upload Document'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filter pill row — radio-style selection across the three media types. */}
      <div className="flex flex-wrap gap-2">
        {FILTER_PILLS.map((pill) => (
          <TagPill
            key={pill.id}
            tag={pill}
            selected={filter === pill.id}
            onClick={() => setFilter(pill.id)}
          />
        ))}
      </div>

      {/* Documents table — unified view of documents + photos + x-rays. */}
      <Card>
        <CardHeader>
          <CardTitle>Documents</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              {['sk-1', 'sk-2', 'sk-3', 'sk-4', 'sk-5'].map((k) => (
                <Skeleton key={k} className="h-12 w-full rounded-md" />
              ))}
            </div>
          ) : visible.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border py-12 text-center">
              <FileText className="h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">No items in this view.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Uploaded</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((item) => {
                  const desc = describeItem(item, toothLabel)
                  const typeTag = {
                    id: `type-${item.mediaType}`,
                    displayName: MEDIA_TYPE_LABEL[item.mediaType],
                    color: MEDIA_TYPE_COLOR[item.mediaType],
                  }
                  return (
                    <TableRow
                      key={`${item.mediaType}:${item.id}`}
                      onClick={() => openItem(item)}
                      className="cursor-pointer hover:bg-muted/50"
                    >
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {desc.icon}
                          <div className="min-w-0">
                            <div className="font-medium truncate">{desc.title}</div>
                            {desc.subtitle && (
                              <div className="text-xs text-muted-foreground truncate">
                                {desc.subtitle}
                              </div>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <TagPill tag={typeTag} />
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                        {desc.categoryLabel}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                        {relativeTime(item.uploadedAt)}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                        {formatBytes(desc.size)}
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              aria-label="Row actions"
                            >
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => openItem(item)}>
                              <Eye className="mr-2 h-4 w-4" />
                              View
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() =>
                                window.open(fileUrlFor(item), '_blank', 'noopener,noreferrer')
                              }
                            >
                              <ExternalLink className="mr-2 h-4 w-4" />
                              Open in new tab
                            </DropdownMenuItem>
                            {canEdit && (
                              <DropdownMenuItem
                                onClick={() => setDeleteTarget(item)}
                                className="text-destructive focus:text-destructive"
                              >
                                <Trash2 className="mr-2 h-4 w-4" />
                                Delete
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Document view sheet (slide-in with breadcrumbs + preview) */}
      <DocumentViewSheet doc={viewerDoc} onClose={() => setViewerDocId(null)} />

      {/* Photo viewer (mirrors PhotosTab) */}
      <Sheet open={!!viewerPhoto} onOpenChange={(o) => !o && setViewerPhoto(null)}>
        <SheetContent side="right" className="!w-full !max-w-[780px] flex flex-col !p-0">
          {viewerPhoto && (
            <>
              <SheetHeader className="shrink-0 space-y-2 border-b px-6 pt-6 pb-4 text-left">
                <nav
                  aria-label="Breadcrumb"
                  className="flex items-center gap-1 text-xs text-muted-foreground"
                >
                  <button
                    type="button"
                    onClick={() => setViewerPhoto(null)}
                    className="rounded px-1 -ml-1 hover:bg-muted hover:text-foreground transition-colors"
                  >
                    Documents
                  </button>
                  <ChevronRight className="h-3 w-3" />
                  <span className="truncate font-medium text-foreground">
                    {PHOTO_CATEGORY_LABELS[viewerPhoto.category]} Photo
                  </span>
                </nav>
                <SheetTitle className="text-xl capitalize">
                  {PHOTO_CATEGORY_LABELS[viewerPhoto.category]} Photo
                </SheetTitle>
              </SheetHeader>
              <div className="flex-1 overflow-y-auto bg-muted/10 p-6 space-y-3">
                <img
                  src={viewerPhoto.imageUrl}
                  alt=""
                  className="mx-auto max-h-[70vh] w-full object-contain rounded-md border border-border"
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
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* X-ray viewer (mirrors XraysTab) */}
      <Sheet open={!!viewerXray} onOpenChange={(o) => !o && setViewerXray(null)}>
        <SheetContent side="right" className="!w-full !max-w-[820px] flex flex-col !p-0">
          {viewerXray && (
            <>
              <SheetHeader className="shrink-0 space-y-2 border-b px-6 pt-6 pb-4 text-left">
                <nav
                  aria-label="Breadcrumb"
                  className="flex items-center gap-1 text-xs text-muted-foreground"
                >
                  <button
                    type="button"
                    onClick={() => setViewerXray(null)}
                    className="rounded px-1 -ml-1 hover:bg-muted hover:text-foreground transition-colors"
                  >
                    Documents
                  </button>
                  <ChevronRight className="h-3 w-3" />
                  <span className="truncate font-medium text-foreground">
                    {viewerXray.type?.displayName || 'X-ray'}
                    {viewerXray.toothNumber != null &&
                      ` — Tooth ${toothLabel(viewerXray.toothNumber)}`}
                  </span>
                </nav>
                <SheetTitle className="text-xl">
                  {viewerXray.type?.displayName || 'X-ray'}
                  {viewerXray.toothNumber != null &&
                    ` — Tooth ${toothLabel(viewerXray.toothNumber)}`}
                </SheetTitle>
              </SheetHeader>
              <div className="flex-1 overflow-y-auto bg-muted/10 p-6 space-y-3">
                <img
                  src={viewerXray.imageUrl}
                  alt=""
                  className="mx-auto max-h-[75vh] w-full object-contain rounded-md border border-border bg-black"
                />
                {viewerXray.origin === 'external' && viewerXray.externalClinicName && (
                  <p className="text-xs text-muted-foreground">
                    Source: {viewerXray.externalClinicName}
                    {viewerXray.externalCapturedDate &&
                      ` · ${format(new Date(viewerXray.externalCapturedDate), 'MMM d, yyyy')}`}
                  </p>
                )}
                {viewerXray.notes && <p className="text-sm">{viewerXray.notes}</p>}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      <DeleteConfirmationDialog
        open={!!deleteTarget}
        onOpenChange={(v) => !v && setDeleteTarget(null)}
        onConfirm={handleDeleteConfirmed}
        isLoading={isDeleting}
        title="Delete item"
        description="This will remove the item from this patient's record."
      />
    </div>
  )
}

// ─── Row describe helper ──────────────────────────────────────────────────────
// Produces the per-type display data for a table row.

function describeItem(
  item: MediaItem,
  toothLabel: (tooth: number) => string
): {
  title: string
  subtitle: string | null
  categoryLabel: string
  size: number | null
  icon: React.ReactNode
} {
  if (item.mediaType === 'photo') {
    const label = PHOTO_CATEGORY_LABELS[item.source.category]
    return {
      title: item.source.notes?.trim() || `${label} Photo`,
      subtitle: null,
      categoryLabel: label,
      // Photos have no stored size in the current schema.
      size: null,
      icon: <ImageIcon className="h-4 w-4 text-muted-foreground shrink-0" />,
    }
  }
  if (item.mediaType === 'xray') {
    const typeName = item.source.type?.displayName || 'X-ray'
    const dateLabel = item.source.capturedAt
      ? (() => {
          try {
            return format(new Date(item.source.capturedAt as string), 'MMM d, yyyy')
          } catch {
            return null
          }
        })()
      : null
    return {
      title: dateLabel ? `${typeName} · ${dateLabel}` : typeName,
      subtitle:
        item.source.toothNumber != null ? `Tooth ${toothLabel(item.source.toothNumber)}` : null,
      categoryLabel: typeName,
      // X-rays have no stored size in the current schema.
      size: null,
      icon: <ScanLine className="h-4 w-4 text-muted-foreground shrink-0" />,
    }
  }
  // Document
  const catLabel = DOC_CATEGORY_LABELS[item.source.category] ?? 'Document'
  const title = item.source.notes?.trim() || item.source.fileName
  return {
    title,
    subtitle: title === item.source.fileName ? null : item.source.fileName,
    categoryLabel: catLabel,
    size: item.source.fileSize,
    icon: <FileText className="h-4 w-4 text-muted-foreground shrink-0" />,
  }
}

// ─── Document view sheet ──────────────────────────────────────────────────────
// Sliding pane that shows a single document with breadcrumbs back to the list.
// The breadcrumb "Documents" link closes the sheet and returns to the table.

function DocumentViewSheet({ doc, onClose }: { doc: PatientDocument | null; onClose: () => void }) {
  if (!doc) return null
  return <DocumentViewSheetBody doc={doc} onClose={onClose} />
}

function DocumentViewSheetBody({ doc, onClose }: { doc: PatientDocument; onClose: () => void }) {
  // The preview keeps its first link while the same file is re-signed, so an
  // open PDF does not reload back to page 1; the buttons use the latest link.
  const previewUrl = useStableFileUrl(doc.fileUrl) ?? undefined
  const title = doc.notes?.trim() || doc.fileName
  const catLabel = DOC_CATEGORY_LABELS[doc.category] ?? 'Document'

  // Cheap file-type sniff for the preview pane.
  const ext = doc.fileName.split('.').pop()?.toLowerCase() ?? ''
  const isImage = ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext)
  const isPdf = ext === 'pdf'

  return (
    <Sheet open={!!doc} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="right" className="!w-full !max-w-[780px] flex flex-col !p-0">
        {/* Sticky header with breadcrumbs + title */}
        <SheetHeader className="shrink-0 space-y-2 border-b px-6 pt-6 pb-4 text-left">
          <nav
            aria-label="Breadcrumb"
            className="flex items-center gap-1 text-xs text-muted-foreground"
          >
            <button
              type="button"
              onClick={onClose}
              className="rounded px-1 -ml-1 hover:bg-muted hover:text-foreground transition-colors"
            >
              Documents
            </button>
            <ChevronRight className="h-3 w-3" />
            <span className="truncate font-medium text-foreground">{title}</span>
          </nav>
          <SheetTitle className="text-xl">{title}</SheetTitle>
        </SheetHeader>

        {/* Metadata row */}
        <div className="shrink-0 grid grid-cols-2 gap-4 border-b bg-muted/30 px-6 py-3 text-xs">
          <div>
            <p className="text-muted-foreground">Uploaded</p>
            <p className="mt-0.5 font-medium">
              {(() => {
                try {
                  return format(new Date(doc.uploadedAt), 'MMM d, yyyy h:mm a')
                } catch {
                  return doc.uploadedAt
                }
              })()}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">Size</p>
            <p className="mt-0.5 font-medium">{formatBytes(doc.fileSize)}</p>
            <p className="mt-0.5 font-mono text-[11px] text-muted-foreground truncate">
              {doc.fileName}
            </p>
          </div>
          <div className="col-span-2">
            <p className="text-muted-foreground mb-1.5">Category</p>
            <TagPill tag={{ id: 'cat', displayName: catLabel, color: 'slate' }} />
          </div>
        </div>

        {/* Preview area */}
        <div className="flex-1 overflow-y-auto bg-muted/10 p-6">
          {isImage ? (
            <img
              src={previewUrl}
              alt={title}
              className="mx-auto max-w-full rounded-lg border border-border shadow-sm"
            />
          ) : isPdf ? (
            <iframe
              src={previewUrl}
              title={title}
              className="h-[70vh] w-full rounded-lg border border-border bg-background"
            />
          ) : (
            <div className="flex h-[40vh] flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border text-center">
              <FileText className="h-10 w-10 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">
                Preview not available for this file type.
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.open(doc.fileUrl, '_blank', 'noopener,noreferrer')}
              >
                <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                Open in new tab
              </Button>
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="shrink-0 flex items-center justify-end gap-2 border-t bg-background px-6 py-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.open(doc.fileUrl, '_blank', 'noopener,noreferrer')}
          >
            <Download className="mr-1.5 h-3.5 w-3.5" />
            Download
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
