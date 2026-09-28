/**
 * HR-app error boundary — thin wrapper over `@denel/app-kit`'s headless
 * `AppErrorBoundary`, injecting the HR error reporter and home path so usage
 * stays `<AppErrorBoundary scope="…">` throughout the app.
 */
import { AppErrorBoundary as KitErrorBoundary } from '@denel/app-kit'
import type { ReactNode } from 'react'
import { reportError } from '@/shared/lib/error-reporting'

export function AppErrorBoundary({ children, scope }: { children: ReactNode; scope?: string }) {
  return (
    <KitErrorBoundary
      scope={scope}
      homePath="/dashboard"
      showDetails={import.meta.env.MODE === 'development'}
      onError={(error, ctx) => reportError(error, ctx)}
    >
      {children}
    </KitErrorBoundary>
  )
}
