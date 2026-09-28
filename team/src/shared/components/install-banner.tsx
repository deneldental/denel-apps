import appIcon from '@denel/assets/pwa/icon.png'
import { Download, Loader2, Share, SquarePlus, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useInstallPrompt } from '@/shared/lib/use-install-prompt'

/**
 * Install-to-home-screen banner for both platforms:
 * - Android / desktop Chromium → a one-tap **Install** button (`beforeinstallprompt`).
 * - iOS Safari → step-by-step guidance (Share → Add to Home Screen), since iOS
 *   has no programmatic install.
 *
 * Shows only when actionable, and hides once installed or dismissed (14 days).
 */

const DISMISS_KEY = 'team_install_dismissed_at'
const REPROMPT_MS = 14 * 24 * 60 * 60 * 1000 // re-offer after two weeks

function isIosDevice(): boolean {
  const ua = navigator.userAgent
  const iPhoneOrPod = /iphone|ipod|ipad/i.test(ua)
  // iPadOS 13+ reports as desktop Safari on "MacIntel" but is touch-capable.
  const iPadOs = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
  return iPhoneOrPod || iPadOs
}

function isSafari(): boolean {
  // Every iOS browser is WebKit, but only Safari exposes Add to Home Screen.
  // Exclude Chrome (CriOS), Firefox (FxiOS), Edge (EdgiOS), Opera (OPiOS).
  const ua = navigator.userAgent
  return /safari/i.test(ua) && !/crios|fxios|edgios|opios|mercury/i.test(ua)
}

function isStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean }
  return (
    window.matchMedia?.('(display-mode: standalone)')?.matches === true || nav.standalone === true
  )
}

function iosEligible(): boolean {
  return typeof window !== 'undefined' && isIosDevice() && isSafari() && !isStandalone()
}

function recentlyDismissed(): boolean {
  try {
    const ts = Number(localStorage.getItem(DISMISS_KEY) ?? 0)
    return ts > 0 && Date.now() - ts < REPROMPT_MS
  } catch {
    return false
  }
}

export function InstallBanner() {
  const { canInstall, promptInstall } = useInstallPrompt()
  const [ios] = useState(iosEligible)
  const [show, setShow] = useState(false)
  const [entered, setEntered] = useState(false)
  const [installing, setInstalling] = useState(false)

  // Prefer the native Android prompt when offered; otherwise fall back to the
  // iOS Safari instructions.
  const mode: 'android' | 'ios' | null = canInstall ? 'android' : ios ? 'ios' : null

  useEffect(() => {
    if (!mode || recentlyDismissed()) return
    // Brief delay so it eases in after the app settles, not on first paint.
    const t = setTimeout(() => {
      setShow(true)
      requestAnimationFrame(() => setEntered(true))
    }, 1200)
    return () => clearTimeout(t)
  }, [mode])

  if (!show || !mode) return null

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()))
    } catch {
      // storage disabled — banner just reappears next session; harmless
    }
    setEntered(false)
    setTimeout(() => setShow(false), 250)
  }

  const onInstall = async () => {
    setInstalling(true)
    await promptInstall()
    setInstalling(false)
    // The prompt is single-use → canInstall flips false → the banner unmounts.
  }

  return (
    <div
      className="fixed inset-x-0 z-50 px-3"
      style={{ bottom: 'calc(var(--nav-height) + var(--safe-bottom) + 0.5rem)' }}
    >
      <div
        className={cn(
          'relative mx-auto max-w-md rounded-2xl border border-border bg-card p-3 shadow-xl transition-all duration-300',
          entered ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0'
        )}
      >
        <div className="flex items-start gap-3">
          <img
            src={appIcon}
            alt="Denel Staff"
            width={44}
            height={44}
            className="h-11 w-11 shrink-0 rounded-xl border border-border"
          />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-foreground">Install Denel Staff</p>
            {mode === 'ios' ? (
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                Tap <Share className="-mt-0.5 inline h-3.5 w-3.5 text-primary" aria-label="Share" />{' '}
                in the toolbar, then{' '}
                <SquarePlus className="-mt-0.5 inline h-3.5 w-3.5 text-primary" aria-hidden />{' '}
                <span className="font-medium text-foreground">Add to Home Screen</span>.
              </p>
            ) : (
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                Add Denel Staff to your home screen for quick, app-like access.
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Dismiss"
            className="-mr-1 -mt-1 shrink-0 rounded-full p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {mode === 'android' && (
          <Button size="sm" className="mt-3 w-full" onClick={onInstall} disabled={installing}>
            {installing ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Download className="mr-1.5 h-4 w-4" />
            )}
            Install app
          </Button>
        )}

        {/* iOS: downward caret hinting toward Safari's share toolbar below. */}
        {mode === 'ios' && (
          <div className="absolute -bottom-1.5 left-1/2 h-3 w-3 -translate-x-1/2 rotate-45 border-b border-r border-border bg-card" />
        )}
      </div>
    </div>
  )
}
