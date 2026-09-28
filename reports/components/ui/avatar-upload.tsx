import { Loader2, TriangleAlert, User, X } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Alert, AlertContent, AlertDescription, AlertIcon, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { formatBytes, useFileUpload } from '@/hooks/use-file-upload'
import { cn } from '@/lib/utils'

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
    onFilesChange: async (files) => {
      if (files.length === 0) return

      const file = files[0]
      setIsUploading(true)

      try {
        // Upload via the storage routing in admin Integrations UI
        const formData = new FormData()
        formData.append('file', file)
        formData.append('storageCategory', 'staff')
        formData.append('folder', 'avatars')
        formData.append('name', entityName)

        const response = await fetch('/api/upload', {
          method: 'POST',
          body: formData,
        })

        const result = await response.json()

        if (!result.success) {
          toast.error(result.error || 'Failed to upload avatar')
          removeFile(file.id)
          return
        }

        // Update with the DO Spaces URL
        setUploadedUrl(result.url)
        onUrlChange?.(result.url)

        // Clean up the file from the hook
        removeFile(file.id)
      } catch (error) {
        console.error('Error uploading avatar:', error)
        toast.error('Failed to upload avatar')
        removeFile(file.id)
      } finally {
        setIsUploading(false)
      }
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
    </div>
  )
}
