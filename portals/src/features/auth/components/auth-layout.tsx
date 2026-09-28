import logoGold from '@denel/assets/logo-gold.png'
import type { ReactNode } from 'react'
import { useBranding } from '@/lib/branding-context'
import { resolvePanelSlides } from '@/shared/lib/brand-panel'

type AuthLayoutProps = {
  /** Page heading, set in Playfair. Sentence case, says what this screen does. */
  title: string
  /** One line under the heading. Optional — the success states don't need it. */
  description?: ReactNode
  children: ReactNode
  /** Secondary actions under the form (back links, "forgot password"). */
  footer?: ReactNode
}

/**
 * Shared shell for the portal auth screens.
 *
 * Two panels: brand on the left, form on the right. Clinic photos sit in the
 * brand panel as navy duotone texture (`mix-blend-luminosity` over the navy
 * ground), so they read as surface rather than competing with the form. That is
 * what lets the form live on plain white — the previous glass-card-over-scrim
 * treatment put navy brand artwork on a dark translucent panel, where neither
 * the logo nor the helper text could hold contrast.
 *
 * The photos cross-fade on a slow Ken Burns cycle; the timing, the zoom and the
 * reduced-motion opt-out all live in `globals.css` under `.auth-panel`.
 *
 * Below `lg` the brand panel collapses to a short band above the form.
 */
export function AuthLayout({ title, description, children, footer }: AuthLayoutProps) {
  const branding = useBranding()
  const slides = resolvePanelSlides(branding.portalLoginImageUrls)

  return (
    <div className="min-h-screen bg-background lg:grid lg:grid-cols-2">
      <aside
        className={`auth-panel auth-panel-${slides.length} relative isolate overflow-hidden bg-[#24296A] px-6 py-10 lg:flex lg:flex-col lg:justify-between lg:px-12 lg:py-14`}
      >
        {slides.map((src, i) => (
          <img
            key={src}
            src={src}
            alt=""
            aria-hidden="true"
            // Only the first frame is needed for the initial paint; the rest
            // are not due for seven seconds each.
            fetchPriority={i === 0 ? 'high' : 'low'}
            className="auth-panel-slide"
            style={{ objectPosition: branding.portalLoginImagePosition }}
          />
        ))}
        {/* Navy is strongest at the head and foot, where the logo and the
            statement sit, and thinnest through the middle so the photo still
            reads. Keeps both legible whatever the admin uploads. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-b from-[#24296A]/90 via-[#24296A]/45 via-48% to-[#1A1E4F]"
        />

        {/* The supplied gold lockup, used whole — it already carries the clinic
            name, so nothing is set in type beside it. `logo-gold.png` is the
            artwork from `Logo - Blue BG.png` with its flat #24296A ground lifted
            to alpha; over this panel it recomposites pixel-identical. */}
        <img
          src={branding.logoHorizontalUrl || logoGold}
          alt={branding.name}
          className="h-auto w-44 max-w-full lg:w-72"
        />

        <p className="mt-6 hidden max-w-sm border-t border-[#B8873A]/50 pt-6 text-sm leading-relaxed text-white/75 lg:block">
          Patient records, appointments, billing and reporting for the {branding.shortName} team.
        </p>
      </aside>

      <main className="flex items-center justify-center px-6 py-12 lg:px-12">
        <div className="w-full max-w-[400px]">
          <h1 className="font-heading text-3xl text-foreground">{title}</h1>
          {description && (
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{description}</p>
          )}
          <div className="mt-8">{children}</div>
          {footer && <div className="mt-6 text-sm">{footer}</div>}
        </div>
      </main>
    </div>
  )
}
