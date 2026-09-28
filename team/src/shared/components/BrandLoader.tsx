import logoMark from '@denel/assets/logo-icon.svg'
import { cn } from '@/lib/utils'

interface BrandLoaderProps {
  className?: string
  size?: number
  showText?: boolean
  text?: string
}

/**
 * App / section loader: the Denel mark fades in and floats over a soft
 * gold-to-navy glow, with a pulsing label and three bouncing dots. The mark is
 * the shared `@denel/assets/logo-icon.svg` — the same file the layouts use —
 * so the loader cannot drift from the logo.
 */
export function BrandLoader({
  className,
  size = 96,
  showText = true,
  text = 'Loading Denel Staff...',
}: BrandLoaderProps) {
  return (
    <div
      className={cn('flex flex-col items-center justify-center space-y-6 select-none', className)}
    >
      {/* Animation Styles */}
      <style>{`
        @keyframes brand-float {
          0%, 100% {
            transform: translateY(0px);
          }
          50% {
            transform: translateY(-10px);
          }
        }

        @keyframes glow-pulse {
          0%, 100% {
            opacity: 0.15;
            transform: scale(0.95) translate(-50%, -50%);
          }
          50% {
            opacity: 0.3;
            transform: scale(1.1) translate(-50%, -50%);
          }
        }

        @keyframes mark-fade-in {
          from {
            opacity: 0;
            transform: scale(0.9) translate3d(0, 5px, 0);
          }
          to {
            opacity: 1;
            transform: scale(1) translate3d(0, 0, 0);
          }
        }

        .loader-float {
          animation: brand-float 3.5s ease-in-out infinite;
          transform-origin: center;
        }

        .loader-glow {
          transform-origin: top left;
          animation: glow-pulse 3.5s ease-in-out infinite;
          filter: blur(24px);
        }

        .loader-mark {
          opacity: 0;
          animation: mark-fade-in 0.8s cubic-bezier(0.16, 1, 0.3, 1) forwards;
          transform-origin: center;
        }
      `}</style>

      {/* Brand mark with a soft glow behind it */}
      <div className="relative" style={{ width: size, height: size }}>
        {/* Pulsing ambient glow behind the mark */}
        <div
          className="loader-glow absolute top-1/2 left-1/2 w-[120%] h-[120%] rounded-full bg-gradient-to-tr from-brand to-primary/60 -translate-x-1/2 -translate-y-1/2 pointer-events-none"
          style={{ transformOrigin: 'center' }}
        />

        <div className="loader-float relative z-10 flex h-full w-full items-center justify-center">
          <img
            src={logoMark}
            alt=""
            aria-hidden="true"
            draggable={false}
            className="loader-mark h-full w-full object-contain"
          />
        </div>
      </div>

      {/* Label Text */}
      {showText && (
        <div className="flex flex-col items-center space-y-1">
          <p className="text-foreground font-semibold text-base tracking-wide animate-pulse">
            {text}
          </p>
          <div className="flex space-x-1.5 items-center justify-center">
            <span
              className="w-1.5 h-1.5 bg-primary rounded-full animate-bounce"
              style={{ animationDelay: '0s' }}
            />
            <span
              className="w-1.5 h-1.5 bg-brand rounded-full animate-bounce"
              style={{ animationDelay: '0.15s' }}
            />
            <span
              className="w-1.5 h-1.5 bg-primary rounded-full animate-bounce"
              style={{ animationDelay: '0.3s' }}
            />
          </div>
        </div>
      )}
    </div>
  )
}
