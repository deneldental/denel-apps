import { Eraser } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from './button'

interface SignaturePadProps {
  value?: string | null // existing base64 PNG
  onChange?: (dataUrl: string | null) => void
  height?: number
  disabled?: boolean
  className?: string
}

/**
 * HTML5 canvas signature capture. Outputs a base64 PNG data URL.
 * Shared across Treatment Plans, Document Signer, and Consent Forms.
 */
export function SignaturePad({
  value,
  onChange,
  height = 180,
  disabled = false,
  className = '',
}: SignaturePadProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [isReady, setIsReady] = useState(false)
  const [hasInk, setHasInk] = useState(Boolean(value))
  const isDrawing = useRef(false)
  const strokeLength = useRef(0)
  const lastPos = useRef<{ x: number; y: number } | null>(null)

  // 1. Initialize canvas size to match CSS layout, accounting for high-DPI displays.
  // We use a ResizeObserver to handle cases where the component mounts inside a hidden tab (width=0).
  useEffect(() => {
    const container = containerRef.current
    const canvas = canvasRef.current
    if (!container || !canvas) return

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height: rectHeight } = entry.contentRect
        if (width > 0 && rectHeight > 0) {
          const dpr = window.devicePixelRatio || 1
          canvas.width = width * dpr
          canvas.height = rectHeight * dpr

          const ctx = canvas.getContext('2d')
          if (ctx) {
            ctx.scale(dpr, dpr)
            // Fill with a solid white background (needed for PNG export and dark-mode safety)
            ctx.fillStyle = '#ffffff'
            ctx.fillRect(0, 0, width, rectHeight)

            ctx.strokeStyle = '#000000'
            ctx.lineWidth = 2.5
            ctx.lineCap = 'round'
            ctx.lineJoin = 'round'

            setIsReady(true)
            observer.disconnect() // Size locked in. Avoid resetting mid-signature if layout shifts slightly.
          }
        }
      }
    })

    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  // 2. Load existing signature if provided (only once after ready)
  useEffect(() => {
    if (!isReady || !value) return
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    const img = new Image()
    img.onload = () => {
      // Draw into the logical CSS coordinate space
      const cssWidth = canvas.width / (window.devicePixelRatio || 1)
      const cssHeight = canvas.height / (window.devicePixelRatio || 1)
      ctx.drawImage(img, 0, 0, cssWidth, cssHeight)
      setHasInk(true)
    }
    img.src = value
  }, [isReady, value])

  // Coordinate mapper that scales correctly even if CSS size slightly mismatched internal size
  function getPos(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()

    const cssWidth = canvas.width / (window.devicePixelRatio || 1)
    const cssHeight = canvas.height / (window.devicePixelRatio || 1)

    return {
      x: (e.clientX - rect.left) * (cssWidth / rect.width),
      y: (e.clientY - rect.top) * (cssHeight / rect.height),
    }
  }

  function start(e: React.PointerEvent<HTMLCanvasElement>) {
    if (disabled || !isReady) return
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    canvas.setPointerCapture(e.pointerId)
    isDrawing.current = true
    strokeLength.current = 0

    const pos = getPos(e)
    lastPos.current = pos

    ctx.beginPath()
    ctx.moveTo(pos.x, pos.y)
  }

  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!isDrawing.current || disabled) return
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx || !lastPos.current) return

    const pos = getPos(e)

    // Accumulate stroke length
    const dx = pos.x - lastPos.current.x
    const dy = pos.y - lastPos.current.y
    strokeLength.current += Math.sqrt(dx * dx + dy * dy)
    lastPos.current = pos

    ctx.lineTo(pos.x, pos.y)
    ctx.stroke()
  }

  function end() {
    if (!isDrawing.current) return
    isDrawing.current = false
    const canvas = canvasRef.current

    // Require a minimum stroke length (e.g. 5px) to prevent accidental taps recording as signatures
    if (strokeLength.current > 5) {
      setHasInk(true)
      if (canvas && onChange) {
        onChange(canvas.toDataURL('image/png'))
      }
    }
  }

  function clear() {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    const cssWidth = canvas.width / (window.devicePixelRatio || 1)
    const cssHeight = canvas.height / (window.devicePixelRatio || 1)

    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, cssWidth, cssHeight)
    setHasInk(false)
    onChange?.(null)
  }

  return (
    <div className={`space-y-2 w-full ${className}`}>
      <div
        ref={containerRef}
        className="w-full rounded-md border border-border bg-background overflow-hidden relative"
        style={{ height }}
      >
        <canvas
          ref={canvasRef}
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
          onPointerLeave={end}
          className={`block touch-none cursor-crosshair w-full h-full ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
        />
        {!isReady && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-50/50">
            <span className="text-xs text-muted-foreground animate-pulse">Initializing...</span>
          </div>
        )}
      </div>
      {!disabled && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            {hasInk ? 'Signed.' : 'Sign within the box using mouse or touch.'}
          </p>
          <Button type="button" variant="ghost" size="sm" onClick={clear} disabled={!hasInk}>
            <Eraser className="mr-1.5 h-3.5 w-3.5" />
            Clear
          </Button>
        </div>
      )}
    </div>
  )
}
