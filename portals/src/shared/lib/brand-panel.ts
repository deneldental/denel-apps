import slide1 from '@denel/assets/auth-slide-1.webp'
import slide2 from '@denel/assets/auth-slide-2.webp'
import slide3 from '@denel/assets/auth-slide-3.webp'

/**
 * Brand photography for the signed-out surfaces — the portal auth screens and
 * the kiosk station. Used when no photos are configured in Settings → Branding.
 *
 * The motion that cross-fades them lives in `globals.css` under `.auth-panel`.
 */
export const PANEL_SLIDES = [slide1, slide2, slide3]

/** Must match the highest `.auth-panel-<n>` keyframe set in `globals.css`. */
export const MAX_PANEL_SLIDES = 6

/**
 * Resolve the frames to show: admin-configured photos win, the shipped Denel
 * set is the fallback, and the list is capped to the keyframe sets that exist.
 */
export function resolvePanelSlides(configured: string[] | undefined): string[] {
  const chosen = (configured ?? []).filter(Boolean)
  return (chosen.length > 0 ? chosen : PANEL_SLIDES).slice(0, MAX_PANEL_SLIDES)
}
