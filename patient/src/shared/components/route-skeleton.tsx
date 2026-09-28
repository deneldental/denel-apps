/**
 * Fallback rendered while a lazy-loaded route chunk is fetching.
 *
 * Matches the role-layout shape — header strip, a few content blocks, and
 * a bottom-tab strip — so the transition between skeleton and real page
 * doesn't feel like the layout is jumping around.
 *
 * Used as the `<Suspense fallback>` for every `lazy()` route in App.tsx.
 */
export function RouteSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading page"
      aria-busy="true"
      className="flex flex-col h-screen bg-background animate-pulse"
    >
      {/* Top bar */}
      <div className="shrink-0 h-14 border-b px-4 flex items-center gap-3">
        <div className="h-8 w-8 rounded-full bg-muted" />
        <div className="h-4 w-32 rounded bg-muted" />
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-hidden p-4 space-y-4">
        <div className="h-24 rounded-lg bg-muted" />
        <div className="h-24 rounded-lg bg-muted" />
        <div className="h-24 rounded-lg bg-muted" />
      </div>

      {/* Bottom tab strip placeholder */}
      <div className="shrink-0 h-16 border-t px-4 flex items-center justify-around">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="flex flex-col items-center gap-1.5">
            <div className="h-5 w-5 rounded bg-muted" />
            <div className="h-2 w-10 rounded bg-muted" />
          </div>
        ))}
      </div>
    </div>
  )
}
