// `?url` makes Vite emit the worker as a real bundled asset and hand back its URL.
// (new URL('bare-specifier', import.meta.url) does NOT bundle in Vite — it 404s.)
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { pdfjs } from 'react-pdf'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

export interface PxRect {
  x: number
  y: number
  w: number
  h: number
}
export interface PointsRect {
  x: number
  y: number
  w: number
  h: number
}

/**
 * Convert a screen-px rect (top-left origin, relative to the rendered page) to
 * PDF points (bottom-left origin — what pdf-lib draws with on the backend).
 * `scale` = renderedWidthPx / pageWidthPts; `heightPx` = the rendered page height.
 */
export function pxToPoints(r: PxRect, scale: number, heightPx: number): PointsRect {
  return {
    x: r.x / scale,
    y: (heightPx - (r.y + r.h)) / scale,
    w: r.w / scale,
    h: r.h / scale,
  }
}

/** Inverse of pxToPoints — position a stored field as a screen-px box (top-left). */
export function pointsToPx(
  f: PointsRect,
  scale: number,
  heightPx: number
): { left: number; top: number; width: number; height: number } {
  return {
    left: f.x * scale,
    top: heightPx - (f.y + f.h) * scale,
    width: f.w * scale,
    height: f.h * scale,
  }
}
