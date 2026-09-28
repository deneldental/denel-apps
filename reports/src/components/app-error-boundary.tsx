import { Component, type ReactNode } from 'react'
import { reportError } from '../lib/error-reporting'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error?: Error
}

/**
 * Root-level error boundary for the reports app. Catches render errors and
 * shows a recovery card so a crash in any component doesn't produce a blank
 * screen. Reports has no Sentry wired up; errors are logged to console only.
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
    console.error('[reports:ErrorBoundary] caught:', error, errorInfo)
    reportError(error, {
      scope: 'react-error-boundary',
      componentStack: errorInfo.componentStack ?? undefined,
    })
  }

  reset = () => {
    this.setState({ hasError: false, error: undefined })
  }

  render() {
    if (!this.state.hasError) return this.props.children

    return (
      <div
        style={{
          display: 'flex',
          minHeight: '100vh',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '1.5rem',
          background: '#f9fafb',
        }}
      >
        <div
          style={{
            maxWidth: 400,
            width: '100%',
            background: '#fff',
            border: '1px solid #e5e7eb',
            borderRadius: 8,
            padding: '1.5rem',
            boxShadow: '0 1px 3px rgba(0,0,0,.08)',
          }}
        >
          <h2 style={{ margin: '0 0 .5rem', fontSize: '1rem', fontWeight: 600 }}>
            Something went wrong
          </h2>
          <p style={{ margin: '0 0 1rem', fontSize: '.875rem', color: '#6b7280' }}>
            An unexpected error occurred in the reports app.
          </p>

          <div style={{ display: 'flex', gap: '.5rem' }}>
            <button
              onClick={this.reset}
              style={{
                flex: 1,
                padding: '.5rem',
                border: '1px solid #d1d5db',
                borderRadius: 6,
                background: '#fff',
                cursor: 'pointer',
                fontSize: '.875rem',
              }}
            >
              Try again
            </button>
            <a
              href="/"
              style={{
                flex: 1,
                padding: '.5rem',
                border: '1px solid #6366f1',
                borderRadius: 6,
                background: '#6366f1',
                color: '#fff',
                textDecoration: 'none',
                textAlign: 'center',
                fontSize: '.875rem',
              }}
            >
              Return to dashboard
            </a>
          </div>

          <p
            style={{
              marginTop: '.75rem',
              fontSize: '.75rem',
              color: '#9ca3af',
              textAlign: 'center',
            }}
          >
            This incident has been automatically reported.
          </p>
        </div>
      </div>
    )
  }
}
