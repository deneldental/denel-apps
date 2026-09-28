import { AlertTriangle, Home, RotateCcw } from 'lucide-react'
import { Component, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/shared/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card'
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
 * Feature-scoped React error boundary. Wrap each major module's routes with
 * one of these so a crash in one area doesn't bring down the whole portal.
 *
 * Also reports the error to the telemetry service (Sentry) when configured.
 *
 * Usage at the registry level:
 *   <AppErrorBoundary scope="patients">
 *     <Route path="/patients" element={<PatientsPage />} />
 *   </AppErrorBoundary>
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
      <div className="flex min-h-[60vh] items-center justify-center p-6">
        <Card className="max-w-md w-full">
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div>
                <CardTitle>Something went wrong</CardTitle>
                <CardDescription className="mt-1">
                  The <span className="font-medium">{this.props.scope ?? 'page'}</span> section
                  crashed. Other parts of the app should still be usable.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {import.meta.env.MODE === 'development' && this.state.error && (
              <pre className="rounded-md bg-muted p-3 text-[10px] overflow-auto max-h-48 whitespace-pre-wrap">
                {this.state.error.message}
                {this.state.error.stack ? `\n\n${this.state.error.stack}` : ''}
              </pre>
            )}
            <div className="flex gap-2">
              <Button onClick={this.reset} variant="outline" className="flex-1">
                <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                Try again
              </Button>
              <Button asChild className="flex-1">
                <Link to="/dashboard">
                  <Home className="mr-1.5 h-3.5 w-3.5" />
                  Back to dashboard
                </Link>
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground text-center">
              This incident has been automatically reported.
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }
}
