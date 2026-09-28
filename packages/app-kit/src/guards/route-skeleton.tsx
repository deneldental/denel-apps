import { Loader2 } from 'lucide-react'

/** Full-screen loading fallback for lazy routes / Suspense boundaries. */
export function RouteSkeleton({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex h-screen items-center justify-center bg-background">
      <div className="text-center">
        <Loader2 className="mx-auto mb-3 h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">{label}</p>
      </div>
    </div>
  )
}
