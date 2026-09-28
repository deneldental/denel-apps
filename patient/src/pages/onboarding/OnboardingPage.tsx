import { CalendarDaysIcon, FileTextIcon, WalletIcon } from '@denel/ui/icons'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

const ONBOARDED_KEY = 'patient_onboarded'

/** Whether this device has already seen the onboarding intro. */
export function hasOnboarded(): boolean {
  try {
    return localStorage.getItem(ONBOARDED_KEY) === '1'
  } catch {
    return false
  }
}

function markOnboarded() {
  try {
    localStorage.setItem(ONBOARDED_KEY, '1')
  } catch {
    // localStorage unavailable (private mode) — onboarding just shows again next time.
  }
}

type IconHandle = { startAnimation?: () => void } | null

interface Slide {
  // biome-ignore lint/suspicious/noExplicitAny: lucide-animated icons share a ref handle but differ by type
  Icon: any
  title: string
  text: string
  ring: string
  tint: string
}

const SLIDES: Slide[] = [
  {
    Icon: CalendarDaysIcon,
    title: 'Book appointments',
    text: 'Request a visit, reschedule, or cancel — right from your phone, anytime.',
    ring: 'bg-emerald-500/10',
    tint: 'text-emerald-500',
  },
  {
    Icon: FileTextIcon,
    title: 'Your records & x-rays',
    text: 'View your treatment history, prescriptions, and imaging whenever you need them.',
    ring: 'bg-sky-500/10',
    tint: 'text-sky-500',
  },
  {
    Icon: WalletIcon,
    title: 'Manage payments',
    text: 'Check invoices, see your balance, and track your wallet credit with ease.',
    ring: 'bg-amber-500/10',
    tint: 'text-amber-500',
  },
]

/** Renders a slide's animated icon and replays its animation on enter + on a loop. */
function SlideIcon({ slide }: { slide: Slide }) {
  const ref = useRef<IconHandle>(null)
  const { Icon } = slide
  useEffect(() => {
    const first = setTimeout(() => ref.current?.startAnimation?.(), 280)
    const id = setInterval(() => ref.current?.startAnimation?.(), 2600)
    return () => {
      clearTimeout(first)
      clearInterval(id)
    }
  }, [])
  return (
    <div className={`flex h-44 w-44 items-center justify-center rounded-full ${slide.ring}`}>
      <span className={slide.tint}>
        <Icon ref={ref} size={112} />
      </span>
    </div>
  )
}

export default function OnboardingPage() {
  const navigate = useNavigate()
  const [index, setIndex] = useState(0)
  const [dir, setDir] = useState(1)
  const isLast = index === SLIDES.length - 1
  const slide = SLIDES[index]

  function finish() {
    markOnboarded()
    navigate('/login', { replace: true })
  }

  function next() {
    if (isLast) {
      finish()
      return
    }
    setDir(1)
    setIndex((i) => i + 1)
  }

  function go(to: number) {
    setDir(to > index ? 1 : -1)
    setIndex(to)
  }

  return (
    <div className="flex min-h-dvh flex-col bg-background px-6 pb-8 pt-5">
      {/* Skip */}
      <div className="flex h-8 justify-end">
        {!isLast && (
          <button
            type="button"
            onClick={finish}
            className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            Skip
          </button>
        )}
      </div>

      {/* Slide */}
      <div className="relative flex flex-1 items-center justify-center overflow-hidden">
        <AnimatePresence mode="wait">
          <motion.div
            key={index}
            initial={{ opacity: 0, x: dir * 56 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: dir * -56 }}
            transition={{ duration: 0.32, ease: 'easeOut' }}
            className="flex flex-col items-center gap-6 text-center"
          >
            <SlideIcon slide={slide} />
            <div className="space-y-2">
              <h1 className="text-2xl font-bold tracking-tight text-foreground">{slide.title}</h1>
              <p className="mx-auto max-w-xs text-pretty text-muted-foreground">{slide.text}</p>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Progress dots */}
      <div className="mb-6 flex justify-center gap-2">
        {SLIDES.map((s, i) => (
          <button
            key={s.title}
            type="button"
            aria-label={`Go to ${s.title}`}
            onClick={() => go(i)}
            className={`h-2 rounded-full transition-all ${
              i === index ? 'w-6 bg-primary' : 'w-2 bg-border'
            }`}
          />
        ))}
      </div>

      {/* CTA */}
      <button
        type="button"
        onClick={next}
        className="h-12 w-full rounded-2xl bg-primary text-base font-semibold text-primary-foreground shadow-sm transition-transform active:scale-[0.98]"
      >
        {isLast ? 'Get started' : 'Next'}
      </button>
    </div>
  )
}
