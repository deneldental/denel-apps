import { useEffect, useState } from 'react'
import { API_BASE_URL } from '@/lib/api-client'
import { cn } from '@/lib/utils'

/**
 * Dev-only indicator for which database the backend is wired to.
 *
 * Local dev has two live candidates — the Docker Postgres and the Neon
 * `framada-dev` branch — and which one you get depends on how the backend was
 * launched (`doppler run -- pnpm dev` → Neon, `scripts/dev-local.mjs` → Docker).
 * Nothing in the UI used to say which, so it was possible to "fix" schema drift
 * in one database while the server read the other. This makes it visible at a
 * glance.
 *
 * Renders nothing in a production build, and nothing if the backend declines to
 * report (it only sends `db` when APP_ENV=development).
 */

type DbProvider = 'docker' | 'neon' | 'digitalocean' | 'unknown'

type HealthResponse = {
  db?: { provider: DbProvider; label: string }
}

/** The two segments a local dev server can realistically be on. */
const SEGMENTS: { provider: DbProvider; label: string }[] = [
  { provider: 'docker', label: 'Docker' },
  { provider: 'neon', label: 'Neon' },
]

export function DbFlavorPill() {
  const [flavor, setFlavor] = useState<HealthResponse['db'] | null>(null)

  useEffect(() => {
    if (!import.meta.env.DEV) return
    let cancelled = false

    fetch(`${API_BASE_URL}/api/health`, { credentials: 'include' })
      .then((r) => (r.ok ? (r.json() as Promise<HealthResponse>) : null))
      .then((data) => {
        if (!cancelled && data?.db) setFlavor(data.db)
      })
      // A dev-only badge must never surface an error of its own — if the
      // backend is down the app already reports that far more loudly.
      .catch(() => {})

    return () => {
      cancelled = true
    }
  }, [])

  if (!import.meta.env.DEV || !flavor) return null

  // Anything that isn't one of the two local candidates (e.g. a dev build
  // pointed at DigitalOcean) gets its own single-segment pill — worth shouting
  // about rather than silently showing neither side lit.
  const isKnownSegment = SEGMENTS.some((s) => s.provider === flavor.provider)

  return (
    <output
      aria-label={`Backend database: ${flavor.label}`}
      title={`Backend is connected to ${flavor.label}`}
      className={cn(
        'fixed bottom-3 left-3 z-50 flex items-center gap-0.5 rounded-full p-0.5',
        'border border-border/60 bg-background/80 shadow-sm backdrop-blur',
        'font-mono text-[10px] leading-none select-none'
      )}
    >
      {isKnownSegment ? (
        SEGMENTS.map((seg) => {
          const active = seg.provider === flavor.provider
          return (
            <span
              key={seg.provider}
              className={cn(
                'rounded-full px-2 py-1 transition-colors',
                active
                  ? seg.provider === 'docker'
                    ? 'bg-sky-500 font-semibold text-white'
                    : 'bg-emerald-500 font-semibold text-white'
                  : 'text-muted-foreground/60'
              )}
            >
              {seg.label}
            </span>
          )
        })
      ) : (
        <span className="rounded-full bg-amber-500 px-2 py-1 font-semibold text-white">
          {flavor.label}
        </span>
      )}
    </output>
  )
}
