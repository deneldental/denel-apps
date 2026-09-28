import { Maximize2, RotateCw, ZoomIn } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import Cropper, { type Area } from 'react-easy-crop'
import { toast } from 'sonner'
import { Button } from '@/shared/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import { uploadAvatar } from '@/shared/lib/upload-blob'

/**
 * Shared avatar cropper.
 *
 * Drives every avatar-upload path in the portal (staff identity + wizard
 * + patient AvatarUpload). When the user picks an image, this dialog opens
 * with the source loaded into a square 1:1 cropper; they can drag to
 * reposition, zoom with a slider or wheel, and rotate in 90° steps. Save
 * returns the cropped output as a JPEG Blob — what consumers persist
 * (data URL for staff local-state, FormData for patient backend upload).
 */
/**
 * When `uploadConfig` is provided, the dialog uploads the cropped image to
 * object storage on confirm and passes the resulting public URL to
 * `onCropped`'s third arg. Without it, callers get the blob + a local preview
 * data URL only (legacy behaviour).
 */
interface UploadConfig {
  kind: 'staff' | 'specialist'
  /** Use `"new"` during create flows; the upload still lands in R2 under that key. */
  id: string
}

export function AvatarCropperDialog({
  open,
  onOpenChange,
  source,
  onCropped,
  outputSize = 512,
  outputType = 'image/jpeg',
  outputQuality = 0.9,
  uploadConfig,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The raw image to crop — File, Blob, or data/object URL. */
  source: File | Blob | string | null
  /** Called when the user confirms the crop. Receives a JPEG blob, a preview
   *  data URL, and (when uploadConfig is set) the persisted object-storage URL. */
  onCropped: (blob: Blob, dataUrl: string, uploadedUrl?: string) => void
  /** Width/height of the output canvas in pixels. Default 512×512. */
  outputSize?: number
  outputType?: string
  outputQuality?: number
  /** When set, the dialog uploads to R2 and provides the URL on confirm. */
  uploadConfig?: UploadConfig
}) {
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [crop, setCrop] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [rotation, setRotation] = useState(0)
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null)
  const [working, setWorking] = useState(false)

  // Normalise source → object URL so the cropper can `<img>` it.
  useEffect(() => {
    if (!source) {
      setImageUrl(null)
      return
    }
    if (typeof source === 'string') {
      setImageUrl(source)
      return
    }
    const url = URL.createObjectURL(source)
    setImageUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [source])

  // Reset transforms whenever a fresh source loads.
  useEffect(() => {
    if (open) {
      setCrop({ x: 0, y: 0 })
      setZoom(1)
      setRotation(0)
      setCroppedAreaPixels(null)
    }
  }, [open])

  const onCropComplete = useCallback((_area: Area, areaPixels: Area) => {
    setCroppedAreaPixels(areaPixels)
  }, [])

  async function handleConfirm() {
    if (!imageUrl || !croppedAreaPixels) return
    setWorking(true)
    try {
      const blob = await renderCropped(imageUrl, croppedAreaPixels, rotation, {
        outputSize,
        outputType,
        outputQuality,
      })
      const dataUrl = await blobToDataUrl(blob)
      let uploadedUrl: string | undefined
      if (uploadConfig) {
        try {
          uploadedUrl = await uploadAvatar(blob, uploadConfig)
        } catch (err: any) {
          toast.error(err?.message || 'Avatar upload failed')
          return
        }
      }
      onCropped(blob, dataUrl, uploadedUrl)
      onOpenChange(false)
    } finally {
      setWorking(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Position &amp; crop</DialogTitle>
          <DialogDescription>
            Drag to reposition. Use the slider to zoom. Use rotate to fix orientation.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Cropper canvas — square aspect, fixed height for a stable layout. */}
          <div className="relative h-64 w-full overflow-hidden rounded-md border bg-muted">
            {imageUrl && (
              <Cropper
                image={imageUrl}
                crop={crop}
                zoom={zoom}
                rotation={rotation}
                aspect={1}
                cropShape="round"
                showGrid={false}
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={onCropComplete}
              />
            )}
          </div>

          {/* Zoom slider */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <ZoomIn className="h-3 w-3" />
                Zoom
              </span>
              <span className="tabular-nums">{Number(zoom).toFixed(1)}×</span>
            </div>
            <input
              type="range"
              min={1}
              max={4}
              step={0.05}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              aria-label="Zoom"
              className="w-full"
            />
          </div>

          {/* Rotate controls */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <RotateCw className="h-3 w-3" />
              Rotate
              <span className="tabular-nums">{rotation}°</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setRotation((r) => (r - 90 + 360) % 360)}
                aria-label="Rotate counter-clockwise"
              >
                <RotateCw className="h-3.5 w-3.5 scale-x-[-1]" />
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setRotation((r) => (r + 90) % 360)}
                aria-label="Rotate clockwise"
              >
                <RotateCw className="h-3.5 w-3.5" />
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setZoom(1)
                  setCrop({ x: 0, y: 0 })
                  setRotation(0)
                }}
                aria-label="Reset transforms"
              >
                <Maximize2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={working}
          >
            Cancel
          </Button>
          <Button type="button" onClick={handleConfirm} disabled={working || !croppedAreaPixels}>
            {working ? (uploadConfig ? 'Uploading…' : 'Saving…') : 'Save crop'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Canvas-based crop renderer ─────────────────────────────────────────────
//
// Loads the source image, applies rotation + crop, and re-encodes at the
// requested output size. Returns a Blob — consumers convert to data URL or
// upload as FormData.

async function renderCropped(
  imageUrl: string,
  area: Area,
  rotation: number,
  opts: { outputSize: number; outputType: string; outputQuality: number }
): Promise<Blob> {
  const img = await loadImage(imageUrl)
  const { outputSize, outputType, outputQuality } = opts

  // Step 1: rotate the source onto an off-screen canvas large enough to hold
  // the rotated bounding box.
  const radians = (rotation * Math.PI) / 180
  const sin = Math.abs(Math.sin(radians))
  const cos = Math.abs(Math.cos(radians))
  const rotatedW = img.naturalWidth * cos + img.naturalHeight * sin
  const rotatedH = img.naturalWidth * sin + img.naturalHeight * cos

  const rotCanvas = document.createElement('canvas')
  rotCanvas.width = rotatedW
  rotCanvas.height = rotatedH
  const rotCtx = rotCanvas.getContext('2d')
  if (!rotCtx) throw new Error('Canvas not supported')
  rotCtx.translate(rotatedW / 2, rotatedH / 2)
  rotCtx.rotate(radians)
  rotCtx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2)

  // Step 2: copy the user-selected crop area onto the output canvas at the
  // configured size. `area` is in the rotated image's coordinate space.
  const out = document.createElement('canvas')
  out.width = outputSize
  out.height = outputSize
  const outCtx = out.getContext('2d')
  if (!outCtx) throw new Error('Canvas not supported')
  outCtx.drawImage(rotCanvas, area.x, area.y, area.width, area.height, 0, 0, outputSize, outputSize)

  return new Promise<Blob>((resolve, reject) => {
    out.toBlob(
      (blob) => {
        if (blob) resolve(blob)
        else reject(new Error('Failed to encode cropped image'))
      },
      outputType,
      outputQuality
    )
  })
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Failed to load image'))
    img.src = src
  })
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}
