import { AlertCircle, Camera, RefreshCw } from 'lucide-react'
import * as React from 'react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export interface CameraCaptureProps {
  facingMode?: 'user' | 'environment'
  aspectRatio?: number
  onCapture: (blob: Blob) => void
  onError?: (err: Error) => void
  active?: boolean
  className?: string
}

export function CameraCapture({
  facingMode = 'environment',
  aspectRatio,
  onCapture,
  onError,
  active = true,
  className,
}: CameraCaptureProps) {
  const videoRef = React.useRef<HTMLVideoElement | null>(null)
  const streamRef = React.useRef<MediaStream | null>(null)
  const [error, setError] = React.useState<Error | null>(null)
  const [_retryToken, setRetryToken] = React.useState(0)

  React.useEffect(() => {
    if (!active) {
      // MUST stop tracks when inactive — otherwise camera light stays on
      if (streamRef.current) {
        for (const track of streamRef.current.getTracks()) track.stop()
        streamRef.current = null
      }
      return
    }

    let cancelled = false

    const start = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode },
          audio: false,
        })
        if (cancelled) {
          for (const track of stream.getTracks()) track.stop()
          return
        }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
        }
        setError(null)
      } catch (err) {
        const e = err instanceof Error ? err : new Error('Failed to access camera')
        if (!cancelled) {
          setError(e)
          onError?.(e)
        }
      }
    }

    void start()

    return () => {
      cancelled = true
      if (streamRef.current) {
        // MUST stop tracks on unmount — otherwise camera light stays on
        for (const track of streamRef.current.getTracks()) track.stop()
        streamRef.current = null
      }
    }
  }, [active, facingMode, onError])

  const handleCapture = React.useCallback(() => {
    const video = videoRef.current
    if (!video?.videoWidth || !video.videoHeight) return
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    canvas.toBlob(
      (blob) => {
        if (blob) onCapture(blob)
      },
      'image/jpeg',
      0.92
    )
  }, [onCapture])

  const handleFileFallback = React.useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (file) onCapture(file)
      e.target.value = ''
    },
    [onCapture]
  )

  const handleRetry = React.useCallback(() => {
    setError(null)
    setRetryToken((t) => t + 1)
  }, [])

  const content = (
    <div className={cn('relative w-full h-full bg-black overflow-hidden', className)}>
      {error ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6 text-center bg-background">
          <AlertCircle className="h-10 w-10 text-destructive" />
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">Camera unavailable</p>
            <p className="text-xs text-muted-foreground break-words max-w-xs">{error.message}</p>
          </div>
          <div className="flex flex-col items-center gap-2 w-full max-w-xs">
            <Button onClick={handleRetry} variant="outline" className="w-full">
              <RefreshCw className="h-4 w-4" />
              Retry
            </Button>
            <label className="w-full">
              <span className="sr-only">Choose image from device</span>
              <input
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handleFileFallback}
                className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-2 file:text-sm file:font-medium file:text-primary-foreground hover:file:bg-primary/90"
              />
            </label>
          </div>
        </div>
      ) : (
        <>
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-cover bg-black"
          />
          <button
            type="button"
            onClick={handleCapture}
            aria-label="Capture photo"
            className="absolute bottom-6 left-1/2 -translate-x-1/2 h-16 w-16 rounded-full bg-white/20 ring-4 ring-white flex items-center justify-center backdrop-blur-sm transition-transform active:scale-95 focus:outline-none focus-visible:ring-4 focus-visible:ring-white"
          >
            <span className="h-12 w-12 rounded-full bg-primary flex items-center justify-center text-primary-foreground">
              <Camera className="h-5 w-5" />
            </span>
          </button>
        </>
      )}
    </div>
  )

  if (aspectRatio) {
    return (
      <div style={{ aspectRatio }} className="w-full">
        {content}
      </div>
    )
  }

  return content
}
