import { AlertTriangle, Home, RotateCcw } from 'lucide-react'
import { Component, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { reportError } from '@/shared/lib/error-reporting'

interface Props {
  children: ReactNode
  /** Human-readable name of the scope this boundary guards — used in error UI + telemetry. */
  scope?: string
  /** Custom fallback renderer; defaults to the built-in card. */
  fallback?: (err: Error, reset: () => void) => ReactNode
}

interface State {
  hasError: boolean
  error?: Error
}

/**
 * Feature-scoped React error boundary for the PWA. Wrap the root (and
 * optionally individual feature subtrees) with one of these so a crash in one
 * area doesn't bring down the whole PWA.
 *
 * Reports the error to the telemetry service (Sentry) when configured.
 */
export class AppErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: { componentStack?: string | null }) {
    // eslint-disable-next-line no-console
    console.error(`[ErrorBoundary:${this.props.scope ?? 'root'}] caught:`, error, errorInfo)
    reportError(error, {
      scope: this.props.scope ?? 'root',
      componentStack: errorInfo.componentStack ?? undefined,
    })
  }

  reset = () => {
    this.setState({ hasError: false, error: undefined })
  }

  render() {
    if (!this.state.hasError) return this.props.children

    if (this.props.fallback && this.state.error) {
      return this.props.fallback(this.state.error, this.reset)
    }

    return (
      <div className="flex min-h-screen items-center justify-center p-6 bg-background">
        <div className="max-w-sm w-full rounded-lg border bg-card p-6 shadow-sm">
          <div className="flex items-center gap-3 mb-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div>
              <h2 className="font-semibold text-foreground">Something went wrong</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                The <span className="font-medium">{this.props.scope ?? 'page'}</span> section
                crashed. Try again, or return home.
              </p>
            </div>
          </div>

          {import.meta.env.MODE === 'development' && this.state.error && (
            <pre className="mb-4 rounded-md bg-muted p-3 text-[10px] overflow-auto max-h-48 whitespace-pre-wrap">
              {this.state.error.message}
              {this.state.error.stack ? `\n\n${this.state.error.stack}` : ''}
            </pre>
          )}

          <div className="flex gap-2">
            <Button onClick={this.reset} variant="outline" className="flex-1">
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
              Try again
            </Button>
            {/* Plain anchor — the root boundary mounts above BrowserRouter,
                so a router <Link> here crashes the fallback itself with
                "Cannot destructure 'basename' of useContext(...) as it is
                null" the moment any upstream error throws. A full nav
                ensures the user can always escape. */}
            <Button asChild className="flex-1">
              <a href="/">
                <Home className="mr-1.5 h-3.5 w-3.5" />
                Home
              </a>
            </Button>
          </div>

          <p className="mt-3 text-[10px] text-muted-foreground text-center">
            This incident has been automatically reported.
          </p>
        </div>
      </div>
    )
  }
}
