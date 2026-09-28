import { Loader2, Upload, X } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { API_BASE_URL } from '@/lib/api-client'
import { cn } from '@/lib/utils'
import { Button } from '@/shared/components/ui/button'
import { formatBytes, useFileUpload } from '@/shared/hooks/use-file-upload'

interface SingleImageUploadProps {
  image: string | null
  onChange: (image: string | null) => void
  maxSize?: number
  folder: 'products' | 'inventory' // Required for proper folder structure
  entityName: string // Required for file naming (product name, inventory name)
}

const DEFAULT_MAX_SIZE = 5 * 1024 * 1024 // 5MB for DO Spaces

export function SingleImageUpload({
  image,
  onChange,
  maxSize = DEFAULT_MAX_SIZE,
  folder,
  entityName,
}: SingleImageUploadProps) {
  const [uploading, setUploading] = useState(false)

  const [
    { isDragging, errors },
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
    onFilesChange: async (newFiles) => {
      if (newFiles.length === 0) return

      const file = newFiles[0]

      // Check file size before upload
      if (file.size > maxSize) {
        toast.error(
          `Image size exceeds the limit of ${formatBytes(maxSize)}. Please choose a smaller image.`
        )
        removeFile(file.id)
        return
      }

      setUploading(true)
      try {
        // Upload via the storage routing in admin Integrations UI
        const formData = new FormData()
        formData.append('file', file)
        formData.append('storageCategory', 'system_docs')
        formData.append('folder', folder)
        formData.append('name', entityName)

        const response = await fetch(`${API_BASE_URL}/api/upload`, {
          method: 'POST',
          credentials: 'include',
          body: formData,
        })

        const result = await response.json()

        if (!result.success) {
          toast.error(result.error || 'Failed to upload image')
          removeFile(file.id)
          return
        }

        // Update with the DO Spaces URL
        onChange(result.url)

        // Clear the hook's files after upload
        removeFile(file.id)
      } catch (error) {
        console.error('Error uploading image:', error)
        toast.error('Failed to upload image')
        removeFile(file.id)
      } finally {
        setUploading(false)
      }
    },
  })

  const handleRemoveImage = () => {
    onChange(null)
  }

  return (
    <div className="space-y-2">
      {image ? (
        <div className="relative group">
          <div className="aspect-square w-full rounded-lg overflow-hidden border border-muted">
            <img src={image} alt="Product" className="w-full h-full object-cover" />
          </div>
          <Button
            type="button"
            size="icon"
            variant="destructive"
            className="absolute top-2 right-2 h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={(e) => {
              e.stopPropagation()
              handleRemoveImage()
            }}
            aria-label="Remove"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        <div
          role="button"
          tabIndex={uploading ? -1 : 0}
          aria-label="Upload product image — click or drag and drop"
          aria-disabled={uploading}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              openFileDialog()
            }
          }}
          className={cn(
            'border-2 border-dashed rounded-lg p-6 transition-colors cursor-pointer',
            isDragging
              ? 'border-primary bg-primary/5'
              : 'border-muted-foreground/25 hover:border-muted-foreground/50',
            uploading && 'opacity-50 pointer-events-none'
          )}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onClick={openFileDialog}
        >
          <input {...getInputProps()} ref={fileInputRef} className="hidden" />

          <div className="flex flex-col items-center justify-center gap-2">
            {uploading ? (
              <Loader2 className="h-8 w-8 text-muted-foreground animate-spin" />
            ) : (
              <Upload className="h-8 w-8 text-muted-foreground" />
            )}
            <div className="text-center">
              <p className="text-sm font-medium">
                {uploading ? 'Uploading...' : 'Click or drag image here'}
              </p>
              <p className="text-xs text-muted-foreground">PNG, JPG up to {formatBytes(maxSize)}</p>
            </div>
          </div>
        </div>
      )}

      {errors.length > 0 && (
        <div className="text-sm text-destructive">
          {errors.map((error, idx) => (
            <p key={idx}>{error}</p>
          ))}
        </div>
      )}
    </div>
  )
}
