import { Check, RefreshCw, X } from 'lucide-react'
import * as React from 'react'

import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { cn } from '@/lib/utils'

import { CameraCapture } from './camera-capture'

export interface CameraSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  facingMode?: 'user' | 'environment'
  title?: string
  onCapture: (blob: Blob) => void
}

export function CameraSheet({
  open,
  onOpenChange,
  facingMode = 'environment',
  title = 'Take photo',
  onCapture,
}: CameraSheetProps) {
  const [previewBlob, setPreviewBlob] = React.useState<Blob | null>(null)
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!previewBlob) {
      setPreviewUrl(null)
      return
    }
    const url = URL.createObjectURL(previewBlob)
    setPreviewUrl(url)
    return () => {
      URL.revokeObjectURL(url)
    }
  }, [previewBlob])

  React.useEffect(() => {
    if (!open && previewBlob) setPreviewBlob(null)
  }, [open, previewBlob])

  const handleClose = React.useCallback(() => {
    setPreviewBlob(null)
    onOpenChange(false)
  }, [onOpenChange])

  const handleCaptured = React.useCallback((blob: Blob) => {
    setPreviewBlob(blob)
  }, [])

  const handleRetake = React.useCallback(() => {
    setPreviewBlob(null)
  }, [])

  const handleUse = React.useCallback(() => {
    if (!previewBlob) return
    onCapture(previewBlob)
    setPreviewBlob(null)
    onOpenChange(false)
  }, [previewBlob, onCapture, onOpenChange])

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className={cn('h-[90vh] flex flex-col p-0 gap-0')}>
        <SheetHeader className="sticky top-0 z-10 flex-row items-center justify-between gap-2 border-b bg-background px-4 py-3 text-left space-y-0">
          <div className="flex flex-col">
            <SheetTitle>{title}</SheetTitle>
            <SheetDescription className="sr-only">
              Use your device camera to capture a photo, then accept or retake.
            </SheetDescription>
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close"
            className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-accent-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="h-5 w-5" />
          </button>
        </SheetHeader>

        <div className="relative flex-1 bg-black overflow-hidden">
          {previewBlob && previewUrl ? (
            <>
              <img
                src={previewUrl}
                alt="Captured preview"
                className="absolute inset-0 w-full h-full object-contain bg-black"
              />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={handleRetake}
                className="absolute top-3 left-3 z-10"
              >
                <RefreshCw className="h-4 w-4" />
                Retake
              </Button>
              <div className="absolute bottom-0 inset-x-0 z-10 p-4 bg-gradient-to-t from-black/70 to-transparent">
                <Button type="button" onClick={handleUse} className="w-full" size="lg">
                  <Check className="h-5 w-5" />
                  Use photo
                </Button>
              </div>
            </>
          ) : (
            <CameraCapture
              facingMode={facingMode}
              active={open && !previewBlob}
              onCapture={handleCaptured}
              className="h-full"
            />
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
