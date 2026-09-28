/**
 * Unit tests for the PWA AppErrorBoundary component.
 *
 * AppErrorBoundary is a class-based React error boundary that:
 *  1. Renders children normally when no error has occurred
 *  2. Catches render errors and shows a "Something went wrong" fallback card
 *  3. Provides a "Try again" button that resets the error state
 *  4. Provides a "Home" link (plain <a href="/">, NOT a router Link) so the
 *     user can always escape even if the Router is above the error
 *  5. Accepts a custom `fallback` render prop for feature-scoped error UIs
 *  6. Reports errors to the telemetry service via reportError()
 *  7. Optionally shows a scoped error label in the fallback card
 *
 * AUDIT FINDING: reports/ app has NO error boundary. This test file serves as
 * documentation of what the boundary guarantees — and a reminder that reports
 * needs its own boundary wired up.
 */
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

// ── Module mocks ──────────────────────────────────────────────────────────────

const mockReportError = vi.fn()

vi.mock('@/shared/lib/error-reporting', () => ({
  reportError: (...args: unknown[]) => mockReportError(...args),
}))

// Suppress the React error boundary console.error noise in test output
const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

// ── Imports ───────────────────────────────────────────────────────────────────

import { AppErrorBoundary } from '@/shared/components/app-error-boundary'

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Component that throws on demand via a ref toggle. */
function BombComponent({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error('Test explosion')
  return <div data-testid="child-content">Safe content</div>
}

/** Component that always throws. */
function AlwaysThrows() {
  throw new Error('Always fails')
}

afterEach(() => {
  vi.clearAllMocks()
})

// ── Normal render ─────────────────────────────────────────────────────────────

describe('AppErrorBoundary — normal render', () => {
  it('renders children when no error occurs', () => {
    render(
      <AppErrorBoundary>
        <div data-testid="healthy-child">All good</div>
      </AppErrorBoundary>
    )
    expect(screen.getByTestId('healthy-child')).toBeInTheDocument()
  })

  it('does not show the fallback card when children render cleanly', () => {
    render(
      <AppErrorBoundary scope="test-scope">
        <div>Normal content</div>
      </AppErrorBoundary>
    )
    expect(screen.queryByText(/something went wrong/i)).not.toBeInTheDocument()
  })

  it('does not call reportError when no error occurs', () => {
    render(
      <AppErrorBoundary>
        <div>Fine</div>
      </AppErrorBoundary>
    )
    expect(mockReportError).not.toHaveBeenCalled()
  })
})

// ── Error catching ────────────────────────────────────────────────────────────

describe('AppErrorBoundary — error catching', () => {
  it('shows "Something went wrong" heading after a child render error', () => {
    render(
      <AppErrorBoundary>
        <AlwaysThrows />
      </AppErrorBoundary>
    )
    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument()
  })

  it('hides the crashed child content after an error', () => {
    render(
      <AppErrorBoundary>
        <AlwaysThrows />
      </AppErrorBoundary>
    )
    // The BombComponent's content must not appear
    expect(screen.queryByTestId('child-content')).not.toBeInTheDocument()
  })

  it('renders a "Try again" button in the fallback', () => {
    render(
      <AppErrorBoundary>
        <AlwaysThrows />
      </AppErrorBoundary>
    )
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
  })

  it('renders a "Home" link (plain anchor) in the fallback', () => {
    render(
      <AppErrorBoundary>
        <AlwaysThrows />
      </AppErrorBoundary>
    )
    const homeLink = screen.getByRole('link', { name: /home/i })
    expect(homeLink).toBeInTheDocument()
    // Must be a plain <a> pointing to / — not a React Router Link
    expect(homeLink.tagName).toBe('A')
    expect(homeLink).toHaveAttribute('href', '/')
  })

  it('calls reportError with the caught error', () => {
    render(
      <AppErrorBoundary>
        <AlwaysThrows />
      </AppErrorBoundary>
    )
    expect(mockReportError).toHaveBeenCalledTimes(1)
    expect(mockReportError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Always fails' }),
      expect.objectContaining({ scope: 'root' })
    )
  })

  it('calls reportError with the custom scope when scope prop is provided', () => {
    render(
      <AppErrorBoundary scope="patient-dashboard">
        <AlwaysThrows />
      </AppErrorBoundary>
    )
    expect(mockReportError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ scope: 'patient-dashboard' })
    )
  })

  it('shows the scope name in the fallback card description', () => {
    render(
      <AppErrorBoundary scope="appointments">
        <AlwaysThrows />
      </AppErrorBoundary>
    )
    expect(screen.getByText(/appointments/i)).toBeInTheDocument()
  })

  it('shows "page" as the default scope label when no scope prop given', () => {
    render(
      <AppErrorBoundary>
        <AlwaysThrows />
      </AppErrorBoundary>
    )
    expect(screen.getByText(/page/i)).toBeInTheDocument()
  })
})

// ── Reset behaviour ───────────────────────────────────────────────────────────

describe('AppErrorBoundary — reset via "Try again"', () => {
  it('re-renders children after clicking "Try again" (children no longer throw)', () => {
    // We need a component we can control — use a counter-based approach
    let throwOnRender = true

    function Controlled() {
      if (throwOnRender) throw new Error('First render bomb')
      return <div data-testid="recovered-content">Recovered!</div>
    }

    const { rerender } = render(
      <AppErrorBoundary>
        <Controlled />
      </AppErrorBoundary>
    )

    // Boundary caught the error
    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument()

    // Fix the child, then click Try Again
    throwOnRender = false
    fireEvent.click(screen.getByRole('button', { name: /try again/i }))

    // After reset the child renders cleanly
    rerender(
      <AppErrorBoundary>
        <Controlled />
      </AppErrorBoundary>
    )
    expect(screen.getByTestId('recovered-content')).toBeInTheDocument()
    expect(screen.queryByText(/something went wrong/i)).not.toBeInTheDocument()
  })

  it('shows fallback again if child throws again after reset', () => {
    let throwOnRender = true

    function ControlledBomb() {
      if (throwOnRender) throw new Error('Repeated failure')
      return <div data-testid="content">OK</div>
    }

    render(
      <AppErrorBoundary>
        <ControlledBomb />
      </AppErrorBoundary>
    )

    // Still failing after reset attempt
    throwOnRender = true
    fireEvent.click(screen.getByRole('button', { name: /try again/i }))

    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument()
  })
})

// ── Custom fallback prop ──────────────────────────────────────────────────────

describe('AppErrorBoundary — custom fallback prop', () => {
  it('calls the fallback render prop with the caught error and reset function', () => {
    const fallbackFn = vi.fn((_err: Error, _reset: () => void) => (
      <div data-testid="custom-fallback">Custom error UI</div>
    ))

    render(
      <AppErrorBoundary fallback={fallbackFn}>
        <AlwaysThrows />
      </AppErrorBoundary>
    )

    // React 18 may invoke the class component render twice during error recovery;
    // assert on args rather than exact call count.
    expect(fallbackFn).toHaveBeenCalled()
    expect(fallbackFn).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Always fails' }),
      expect.any(Function)
    )
    expect(screen.getByTestId('custom-fallback')).toBeInTheDocument()
  })

  it('does not render the built-in "Something went wrong" card when custom fallback is provided', () => {
    render(
      <AppErrorBoundary fallback={() => <div>My custom error</div>}>
        <AlwaysThrows />
      </AppErrorBoundary>
    )
    expect(screen.queryByText(/something went wrong/i)).not.toBeInTheDocument()
    expect(screen.getByText(/my custom error/i)).toBeInTheDocument()
  })

  it('custom fallback reset function clears the error state', () => {
    let capturedReset: (() => void) | null = null

    const fallbackFn = (_err: Error, reset: () => void) => {
      capturedReset = reset
      return <div data-testid="custom-fallback">Error!</div>
    }

    let shouldThrow = true
    function Controlled() {
      if (shouldThrow) throw new Error('custom fallback test')
      return <div data-testid="child">Good</div>
    }

    render(
      <AppErrorBoundary fallback={fallbackFn}>
        <Controlled />
      </AppErrorBoundary>
    )

    expect(screen.getByTestId('custom-fallback')).toBeInTheDocument()
    expect(capturedReset).not.toBeNull()

    // Fix + reset — wrap in act() so React flushes the setState synchronously
    shouldThrow = false
    act(() => {
      capturedReset!()
    })

    expect(screen.getByTestId('child')).toBeInTheDocument()
  })
})

// ── Multiple boundaries ───────────────────────────────────────────────────────

describe('AppErrorBoundary — nested boundaries', () => {
  it('inner boundary catches inner error; outer boundary stays clean', () => {
    render(
      <AppErrorBoundary scope="outer">
        <div data-testid="outer-content">Outer safe</div>
        <AppErrorBoundary scope="inner">
          <AlwaysThrows />
        </AppErrorBoundary>
      </AppErrorBoundary>
    )

    // Outer content still renders
    expect(screen.getByTestId('outer-content')).toBeInTheDocument()
    // Inner boundary shows its fallback
    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument()
    // The outer-level "Something went wrong" should NOT appear (outer is clean)
    expect(screen.getAllByText(/something went wrong/i)).toHaveLength(1)
  })
})

// ── Error info in fallback ────────────────────────────────────────────────────

describe('AppErrorBoundary — reporting guarantee', () => {
  it('error is reported exactly once per boundary activation', () => {
    render(
      <AppErrorBoundary>
        <AlwaysThrows />
      </AppErrorBoundary>
    )
    expect(mockReportError).toHaveBeenCalledTimes(1)
  })

  it('fallback card always shows "automatically reported" footer', () => {
    render(
      <AppErrorBoundary>
        <AlwaysThrows />
      </AppErrorBoundary>
    )
    expect(screen.getByText(/automatically reported/i)).toBeInTheDocument()
  })
})
