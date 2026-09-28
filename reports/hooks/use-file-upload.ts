import { useCallback, useRef, useState } from 'react'

export interface FileWithPreview extends File {
  id: string
  preview: string
}

interface UseFileUploadOptions {
  maxFiles?: number
  maxSize?: number
  accept?: string
  multiple?: boolean
  onFilesChange?: (files: FileWithPreview[]) => void
}

interface UseFileUploadReturn {
  files: FileWithPreview[]
  isDragging: boolean
  errors: string[]
}

interface UseFileUploadActions {
  removeFile: (id: string) => void
  handleDragEnter: (e: React.DragEvent) => void
  handleDragLeave: (e: React.DragEvent) => void
  handleDragOver: (e: React.DragEvent) => void
  handleDrop: (e: React.DragEvent) => void
  openFileDialog: () => void
  getInputProps: () => {
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
    accept?: string
    multiple?: boolean
    type: string
  }
  fileInputRef: React.RefObject<HTMLInputElement | null>
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes'
  const k = 1024
  const sizes = ['Bytes', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${Math.round((bytes / k ** i) * 100) / 100} ${sizes[i]}`
}

export function useFileUpload(
  options: UseFileUploadOptions = {}
): [UseFileUploadReturn, UseFileUploadActions] {
  const {
    maxFiles = 1,
    maxSize = 5 * 1024 * 1024, // 5MB default
    accept,
    multiple = false,
    onFilesChange,
  } = options

  const [files, setFiles] = useState<FileWithPreview[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const [errors, setErrors] = useState<string[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dragCounterRef = useRef(0)

  const validateFile = useCallback(
    (file: File): string | null => {
      if (maxSize && file.size > maxSize) {
        return `File "${file.name}" exceeds maximum size of ${formatBytes(maxSize)}`
      }
      if (accept) {
        const acceptedTypes = accept.split(',').map((type) => type.trim())
        const fileType = file.type
        const fileExtension = `.${file.name.split('.').pop()?.toLowerCase()}`
        const isAccepted = acceptedTypes.some(
          (type) =>
            fileType.match(type.replace('*', '.*')) || fileExtension.match(type.replace('*', '.*'))
        )
        if (!isAccepted) {
          return `File "${file.name}" is not an accepted file type. Accepted: ${accept}`
        }
      }
      return null
    },
    [maxSize, accept]
  )

  const createFileWithPreview = (file: File): FileWithPreview => {
    const id = Math.random().toString(36).substring(2, 9)
    const preview = URL.createObjectURL(file)
    return Object.assign(file, { id, preview })
  }

  const processFiles = useCallback(
    (newFiles: FileList | File[]) => {
      const fileArray = Array.from(newFiles)
      const validFiles: FileWithPreview[] = []
      const newErrors: string[] = []

      // Check max files limit
      const remainingSlots = maxFiles - files.length
      if (fileArray.length > remainingSlots) {
        newErrors.push(
          `Maximum ${maxFiles} file(s) allowed. Only ${remainingSlots} slot(s) remaining.`
        )
        fileArray.splice(remainingSlots)
      }

      fileArray.forEach((file) => {
        const error = validateFile(file)
        if (error) {
          newErrors.push(error)
        } else {
          validFiles.push(createFileWithPreview(file))
        }
      })

      if (validFiles.length > 0) {
        const updatedFiles = multiple ? [...files, ...validFiles] : validFiles
        setFiles(updatedFiles)
        onFilesChange?.(updatedFiles)
      }

      if (newErrors.length > 0) {
        setErrors(newErrors)
        setTimeout(() => setErrors([]), 5000) // Clear errors after 5 seconds
      }
    },
    [files, maxFiles, multiple, onFilesChange, validateFile, createFileWithPreview]
  )

  const removeFile = useCallback(
    (id: string) => {
      const fileToRemove = files.find((f) => f.id === id)
      if (fileToRemove) {
        URL.revokeObjectURL(fileToRemove.preview)
      }
      const updatedFiles = files.filter((f) => f.id !== id)
      setFiles(updatedFiles)
      onFilesChange?.(updatedFiles)
    },
    [files, onFilesChange]
  )

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current++
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setIsDragging(true)
    }
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current--
    if (dragCounterRef.current === 0) {
      setIsDragging(false)
    }
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setIsDragging(false)
      dragCounterRef.current = 0

      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        processFiles(e.dataTransfer.files)
      }
    },
    [processFiles]
  )

  const openFileDialog = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
        processFiles(e.target.files)
      }
      // Reset input so same file can be selected again
      e.target.value = ''
    },
    [processFiles]
  )

  const getInputProps = useCallback(
    () => ({
      onChange: handleInputChange,
      accept,
      multiple,
      type: 'file',
    }),
    [handleInputChange, accept, multiple]
  )

  return [
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
  ]
}
