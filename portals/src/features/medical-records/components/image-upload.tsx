import { Loader2, Upload, X } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { api } from '@/lib/api-client'
import { cn } from '@/lib/utils'
import { Button } from '@/shared/components/ui/button'
import { formatBytes, useFileUpload } from '@/shared/hooks/use-file-upload'

interface ImageUploadProps {
  images: string[]
  onChange: (images: string[]) => void
  maxImages?: number
  maxSize?: number
  patientName: string // Required for proper file naming in treatments folder
  patientCreatedDate: Date // Required for patient folder naming
}

export function ImageUpload({
  images,
  onChange,
  maxImages = 10,
  maxSize = 5 * 1024 * 1024,
  patientName,
  patientCreatedDate,
}: ImageUploadProps) {
  const [uploading, setUploading] = useState(false)

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
    maxFiles: maxImages - images.length,
    maxSize,
    accept: 'image/*',
    multiple: true,
    onFilesChange: async (newFiles) => {
      if (newFiles.length === 0) return

      setUploading(true)
      try {
        const uploadedUrls: string[] = []

        // Upload files sequentially with proper indexing
        for (let i = 0; i < newFiles.length; i++) {
          const file = newFiles[i]
          const currentIndex = images.length + i + 1 // Start from current count + 1

          const formData = new FormData()
          formData.append('file', file)
          formData.append('storageCategory', 'patient_records')
          formData.append('folder', 'treatments')
          formData.append('name', patientName)
          formData.append('index', currentIndex.toString())

          // Create patient subfolder with format: [fullname]_[ddMMMyyyy]
          const day = String(patientCreatedDate.getDate()).padStart(2, '0')
          const months = [
            'jan',
            'feb',
            'mar',
            'apr',
            'may',
            'jun',
            'jul',
            'aug',
            'sep',
            'oct',
            'nov',
            'dec',
          ]
          const month = months[patientCreatedDate.getMonth()]
          const year = patientCreatedDate.getFullYear()
          const formattedDate = `${day}${month}${year}`
          const sanitizedName = patientName
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, '')
            .replace(/\s+/g, '_')
          const subfolder = `${sanitizedName}_${formattedDate}`

          formData.append('subfolder', subfolder)

          const result = await api.post<{ url: string }>('/api/upload', formData)

          if (!result.success) {
            toast.error(result.error || `Failed to upload image ${i + 1}`)
            continue
          }

          if (result.data?.url) {
            uploadedUrls.push(result.data.url)
          }
        }

        if (uploadedUrls.length > 0) {
          onChange([...images, ...uploadedUrls])
        }

        // Clear the hook's files after upload
        newFiles.forEach((file) => removeFile(file.id))
      } catch (error) {
        console.error('Error uploading images:', error)
        toast.error('Failed to upload images')
      } finally {
        setUploading(false)
      }
    },
  })

  const handleRemoveImage = (index: number) => {
    const newImages = images.filter((_, i) => i !== index)
    onChange(newImages)
  }

  return (
    <div className="space-y-2">
      <div
        role="button"
        tabIndex={uploading ? -1 : 0}
        aria-label="Upload images — click or drag and drop"
        aria-disabled={uploading}
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
        onKeyDown={(e) => {
          if (!uploading && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault()
            openFileDialog()
          }
        }}
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
              {uploading ? 'Uploading...' : 'Click or drag images here'}
            </p>
            <p className="text-xs text-muted-foreground">
              PNG, JPG up to {formatBytes(maxSize)} (max {maxImages} images)
            </p>
          </div>
        </div>
      </div>

      {errors.length > 0 && (
        <div className="text-sm text-destructive">
          {errors.map((error, idx) => (
            <p key={idx}>{error}</p>
          ))}
        </div>
      )}

      {images.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mt-4">
          {images.map((image, index) => (
            <div key={index} className="relative group">
              <div className="aspect-square rounded-lg overflow-hidden border border-muted">
                <img
                  src={image}
                  alt={`Attachment ${index + 1}`}
                  className="w-full h-full object-cover"
                />
              </div>
              <Button
                type="button"
                size="icon"
                variant="destructive"
                className="absolute top-2 right-2 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={(e) => {
                  e.stopPropagation()
                  handleRemoveImage(index)
                }}
                aria-label="Remove"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
