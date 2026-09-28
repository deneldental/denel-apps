import { Loader2, TriangleAlert, User, X } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { uploadFile } from '@/lib/actions/upload'
import { API_BASE_URL } from '@/lib/api-client'
import { cn } from '@/lib/utils'
import { AvatarCropperDialog } from '@/shared/components/avatar-cropper-dialog'
import {
  Alert,
  AlertContent,
  AlertDescription,
  AlertIcon,
  AlertTitle,
} from '@/shared/components/ui/alert'
import { Button } from '@/shared/components/ui/button'
import { formatBytes, useFileUpload } from '@/shared/hooks/use-file-upload'

interface AvatarUploadProps {
  maxSize?: number
  className?: string
  onUrlChange?: (url: string | null) => void // Changed to return URL instead of File
  defaultAvatar?: string
  entityName: string // Name for file naming (patient name, user name, etc.)
}

export default function AvatarUpload({
  maxSize = 2 * 1024 * 1024, // 2MB
  className,
  onUrlChange,
  defaultAvatar,
  entityName,
}: AvatarUploadProps) {
  const [uploadedUrl, setUploadedUrl] = useState<string | null>(defaultAvatar || null)
  const [isUploading, setIsUploading] = useState(false)
  // PR-13 — open the crop dialog before upload. Set when the file picker
  // resolves; cleared when the user confirms or cancels.
  const [cropperSource, setCropperSource] = useState<{
    fileId: string
    file: File
  } | null>(null)

  async function uploadCroppedBlob(blob: Blob) {
    setIsUploading(true)
    try {
      const filename = `avatar-${Date.now()}.jpg`
      const file = new File([blob], filename, { type: blob.type || 'image/jpeg' })

      // Every upload gets its own file: the name alone collided — two people
      // with the same name overwrote each other's photo, and callers that pass
      // a placeholder name all shared one file. The timestamp makes it unique;
      // the name stays in front so the storage browser remains readable.
      const result = await uploadFile(file, {
        storageCategory: 'staff',
        folder: 'avatars',
        name: `${entityName || 'avatar'} ${Date.now()}`,
      })

      if (!result.success) {
        toast.error(result.error || 'Failed to upload avatar')
        return
      }

      setUploadedUrl(result.url || null)
      onUrlChange?.(result.url || null)
    } catch (error) {
      console.error('Error uploading avatar:', error)
      toast.error('Failed to upload avatar')
    } finally {
      setIsUploading(false)
    }
  }

  const [
    { files, isDragging, errors },
    {
      removeFile,
      handleDragEnter,
      handleDragLeave,
      handleDragOver,
      handleDrop,
      openFileDialog,
      getInputProps,
      fileInputRef,
    },
  ] = useFileUpload({
    maxFiles: 1,
    maxSize,
    accept: 'image/*',
    multiple: false,
    onFilesChange: (files) => {
      if (files.length === 0) return
      const f = files[0]
      // Hand off to the crop dialog. `FileWithPreview` extends File, so the
      // hook entry itself is a File suitable for the cropper input.
      setCropperSource({ fileId: f.id, file: f })
    },
  })

  const currentFile = files[0]
  const previewUrl = currentFile?.preview || uploadedUrl

  const handleRemove = () => {
    if (currentFile) {
      removeFile(currentFile.id)
    }
    setUploadedUrl(null)
    onUrlChange?.(null)
  }

  return (
    <div className={cn('flex flex-col items-center gap-4', className)}>
      {/* Avatar Preview */}
      <div className="relative">
        <div
          role="button"
          tabIndex={isUploading ? -1 : 0}
          aria-label="Upload avatar — click or drag and drop"
          aria-disabled={isUploading}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              openFileDialog()
            }
          }}
          className={cn(
            'group/avatar relative h-24 w-24 cursor-pointer overflow-hidden rounded-full border border-dashed transition-colors',
            isDragging
              ? 'border-primary bg-primary/5'
              : 'border-muted-foreground/25 hover:border-muted-foreground/20',
            previewUrl && 'border-solid',
            isUploading && 'opacity-50 pointer-events-none'
          )}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onClick={openFileDialog}
        >
          <input {...getInputProps()} ref={fileInputRef} className="sr-only" />

          {isUploading ? (
            <div className="flex h-full w-full items-center justify-center">
              <Loader2 className="size-6 text-muted-foreground animate-spin" />
            </div>
          ) : previewUrl ? (
            <img
              src={previewUrl}
              alt="Avatar"
              width={96}
              height={96}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <User className="size-6 text-muted-foreground" />
            </div>
          )}
        </div>

        {/* Remove Button - only show when file is uploaded */}
        {(currentFile || uploadedUrl) && !isUploading && (
          <Button
            size="icon"
            variant="outline"
            onClick={handleRemove}
            className="size-6 absolute end-0 top-0 rounded-full"
            aria-label="Remove avatar"
          >
            <X className="size-3.5" />
          </Button>
        )}
      </div>

      {/* Upload Instructions */}
      <div className="text-center space-y-0.5">
        <p className="text-sm font-medium">
          {isUploading ? 'Uploading...' : uploadedUrl ? 'Avatar uploaded' : 'Upload avatar'}
        </p>
        <p className="text-xs text-muted-foreground">PNG, JPG up to {formatBytes(maxSize)}</p>
      </div>

      {/* Error Messages */}
      {errors.length > 0 && (
        <Alert variant="destructive" appearance="light" className="mt-5">
          <AlertIcon>
            <TriangleAlert />
          </AlertIcon>
          <AlertContent>
            <AlertTitle>File upload error(s)</AlertTitle>
            <AlertDescription>
              {errors.map((error, index) => (
                <p key={index} className="last:mb-0">
                  {error}
                </p>
              ))}
            </AlertDescription>
          </AlertContent>
        </Alert>
      )}

      <AvatarCropperDialog
        open={!!cropperSource}
        onOpenChange={(open) => {
          if (!open) {
            // User cancelled the crop — drop the pending file so the dropzone
            // is ready for another attempt.
            if (cropperSource) removeFile(cropperSource.fileId)
            setCropperSource(null)
          }
        }}
        source={cropperSource?.file ?? null}
        onCropped={async (blob) => {
          if (cropperSource) removeFile(cropperSource.fileId)
          setCropperSource(null)
          await uploadCroppedBlob(blob)
        }}
      />
    </div>
  )
}
