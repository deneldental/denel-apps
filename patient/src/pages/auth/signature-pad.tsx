import { useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'

/**
 * Lightweight canvas signature pad. Emits a base64 PNG data URL via `onChange`
 * (or null when empty/cleared). Pointer-based so it works with touch + mouse.
 */
export function SignaturePad({ onChange }: { onChange: (dataUrl: string | null) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const inked = useRef(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    // Size the backing store to the CSS box × DPR for crisp strokes.
    const ratio = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    canvas.width = rect.width * ratio
    canvas.height = rect.height * ratio
    const ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.scale(ratio, ratio)
      ctx.lineWidth = 2
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.strokeStyle = '#0f172a'
    }
  }, [])

  function pointAt(e: React.PointerEvent) {
    const rect = canvasRef.current!.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  function start(e: React.PointerEvent) {
    e.preventDefault()
    drawing.current = true
    const ctx = canvasRef.current?.getContext('2d')
    const { x, y } = pointAt(e)
    ctx?.beginPath()
    ctx?.moveTo(x, y)
  }

  function move(e: React.PointerEvent) {
    if (!drawing.current) return
    const ctx = canvasRef.current?.getContext('2d')
    const { x, y } = pointAt(e)
    ctx?.lineTo(x, y)
    ctx?.stroke()
    inked.current = true
  }

  function end() {
    if (!drawing.current) return
    drawing.current = false
    const canvas = canvasRef.current
    onChange(inked.current && canvas ? canvas.toDataURL('image/png') : null)
  }

  function clear() {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height)
    inked.current = false
    onChange(null)
  }

  return (
    <div className="space-y-2">
      <canvas
        ref={canvasRef}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
        className="h-36 w-full touch-none rounded-xl border border-border bg-card"
      />
      <div className="flex justify-end">
        <Button type="button" variant="outline" size="sm" onClick={clear}>
          Clear
        </Button>
      </div>
    </div>
  )
}
