import type { ForwardRefExoticComponent, ReactNode, RefAttributes } from 'react'
import { useEffect, useRef } from 'react'
import { MoonIcon, SunDimIcon, SunIcon } from '../icons'

/**
 * WelcomeCard — a personal home-screen greeting header: time-of-day greeting +
 * name on a soft brand gradient, with an animated time-of-day icon on the right.
 * Pure presentational. Pass `action` to replace the weather icon (e.g. a
 * notifications bell) and `subtitle` for the small line under the name.
 */

/** The lucide-animated icons all share this imperative handle. */
type AnimatedIconHandle = { startAnimation: () => void; stopAnimation: () => void }
type AnimatedIcon = ForwardRefExoticComponent<{ size?: number } & RefAttributes<AnimatedIconHandle>>

function greetingForNow(): string {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

/** Picks the time-of-day icon + tint: early morning → midday → evening. The
 *  daytime glows are the brand gold (#B8873A); the evening one stays indigo. */
function timeOfDayIcon(): { Icon: AnimatedIcon; tint: string; glow: string } {
  const h = new Date().getHours()
  if (h < 12)
    return {
      Icon: SunDimIcon as unknown as AnimatedIcon,
      tint: 'text-amber-300',
      glow: 'rgba(184,135,58,0.30)',
    }
  if (h < 17)
    return {
      Icon: SunIcon as unknown as AnimatedIcon,
      tint: 'text-amber-400',
      glow: 'rgba(184,135,58,0.38)',
    }
  return {
    Icon: MoonIcon as unknown as AnimatedIcon,
    tint: 'text-indigo-300',
    glow: 'rgba(99,102,241,0.35)',
  }
}

/** Animated time-of-day icon (lucide-animated set) — gently replays on a loop. */
function WeatherIcon() {
  const ref = useRef<AnimatedIconHandle>(null)
  useEffect(() => {
    const start = setTimeout(() => ref.current?.startAnimation(), 350)
    const loop = setInterval(() => ref.current?.startAnimation(), 4000)
    return () => {
      clearTimeout(start)
      clearInterval(loop)
    }
  }, [])
  const { Icon, tint, glow } = timeOfDayIcon()
  return (
    <div className={`shrink-0 ${tint}`} style={{ filter: `drop-shadow(0 2px 8px ${glow})` }}>
      <Icon ref={ref} size={52} />
    </div>
  )
}

export interface WelcomeCardProps {
  /** First name (or greeting name); rendered large with a waving hand. */
  name: string
  /** Overrides the automatic time-of-day greeting. */
  greeting?: string
  /** Small line under the name (e.g. patient ID, role, department). */
  subtitle?: ReactNode
  /** Right-side slot. Defaults to the animated time-of-day icon. */
  action?: ReactNode
}

export function WelcomeCard({
  name,
  greeting = greetingForNow(),
  subtitle,
  action,
}: WelcomeCardProps) {
  return (
    <section className="flex items-center justify-between gap-3 rounded-2xl border border-border/60 bg-gradient-to-br from-brand/15 to-brand/5 p-5">
      <div className="min-w-0">
        <p className="text-sm text-muted-foreground">{greeting},</p>
        <h1 className="truncate text-2xl font-bold tracking-tight text-foreground">{name} 👋</h1>
        {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
      </div>
      {action ?? <WeatherIcon />}
    </section>
  )
}
