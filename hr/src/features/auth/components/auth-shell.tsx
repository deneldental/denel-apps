import loginBg from '@denel/assets/bg.webp'
import logo from '@denel/assets/logo.png'
import logoGold from '@denel/assets/logo-gold.png'
import { Badge, Card, CardContent, CardDescription, CardHeader } from '@denel/ui'
import type { ReactNode } from 'react'

// Brand colour for the pill + primary action on every auth screen. HR uses the
// shared Denel theme, so this is the `primary` token: navy #24296A in light
// mode, light periwinkle in dark mode (theme/dark.css). Kept here as the single
// source of truth across the login / forgot / reset screens.
export const BRAND_BUTTON_CLASS = 'bg-primary text-primary-foreground hover:bg-primary/90'

/**
 * Shared chrome for every HR auth screen (login / forgot / reset): the brand
 * background + overlay, the clinic logo, the "Human Resources" pill, a
 * per-screen description, and the copyright footer. Screens supply only their
 * own form/actions as `children`.
 */
export function AuthShell({
  description,
  headerExtra,
  children,
}: {
  /** Guidance line under the pill — changes per screen/step. */
  description: ReactNode
  /** Optional element between the pill and the description (e.g. a status icon). */
  headerExtra?: ReactNode
  children: ReactNode
}) {
  return (
    <div
      className="relative flex min-h-screen items-center justify-center p-6"
      style={{
        backgroundImage: `url(${loginBg})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }}
    >
      <div className="absolute inset-0 bg-black/40" />
      <Card className="relative z-10 w-full max-w-sm shadow-2xl">
        <CardHeader className="space-y-3 text-center">
          {/* Navy lockup on the light card; in dark mode the card turns navy-black and
              the navy wordmark disappears, so show the gold lockup made for navy
              grounds instead. */}
          <img
            src={logo}
            alt="Denel Dental Clinic"
            className="mx-auto max-h-12 w-auto object-contain dark:hidden"
          />
          <img
            src={logoGold}
            alt="Denel Dental Clinic"
            className="mx-auto hidden max-h-12 w-auto object-contain dark:block"
          />
          <div className="flex justify-center">
            <Badge className="border-transparent bg-primary px-3 py-1 text-xs font-semibold tracking-wide text-primary-foreground hover:bg-primary">
              Human Resources
            </Badge>
          </div>
          {headerExtra}
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>

      <footer className="absolute inset-x-0 bottom-4 z-10 px-4 text-center text-xs text-white/80 drop-shadow">
        &copy; {new Date().getFullYear()} Denel Dental Clinic. All rights reserved.
      </footer>
    </div>
  )
}
