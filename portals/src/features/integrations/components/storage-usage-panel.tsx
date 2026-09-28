import { AlertTriangle, RefreshCw } from 'lucide-react'
import { getProviderUsage, type ProviderUsage } from '@/lib/actions/integrations'
import { useApiQuery } from '@/lib/query'
import { Button } from '@/shared/components/ui/button'

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const i = Math.min(UNITS.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const value = bytes / 1024 ** i
  const formatted = value >= 100 ? Number(value).toFixed(0) : Number(value).toFixed(1)
  return `${formatted} ${UNITS[i]}`
}

export interface StorageUsagePanelProps {
  providerId: 'r2' | 'do_spaces' | 'cloudinary'
  /**
   * Skip the auto-fetch on mount when the provider isn't configured yet.
   * The panel renders a placeholder instead.
   */
  enabled?: boolean
}

export function StorageUsagePanel({ providerId, enabled = true }: StorageUsagePanelProps) {
  const query = useApiQuery(
    ['integrations', 'storage-usage', providerId] as const,
    () => getProviderUsage(providerId),
    { enabled }
  )
  const usage = query.data ?? null
  const loading = query.isFetching
  const error = query.error ? query.error.message : null

  if (!enabled) {
    return (
      <div className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
        Configure credentials and save to see storage usage.
      </div>
    )
  }

  return (
    <div className="space-y-2 rounded-md border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Storage usage
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() => query.refetch()}
          disabled={loading}
        >
          <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {loading && !usage && (
        <div className="space-y-2">
          <div className="h-2 rounded-full bg-muted animate-pulse" />
          <div className="h-3 w-32 rounded bg-muted animate-pulse" />
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 text-xs text-destructive">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {usage && !error && <UsageBar usage={usage} />}
    </div>
  )
}

function UsageBar({ usage }: { usage: ProviderUsage }) {
  const { usedBytes, quotaBytes, objectCount, partial, note } = usage
  const hasQuota = quotaBytes != null && quotaBytes > 0
  const pct = hasQuota
    ? Math.min(100, Math.max(0, (usedBytes / (quotaBytes as number)) * 100))
    : null

  let barColor = 'bg-emerald-500'
  if (pct != null) {
    if (pct >= 90) barColor = 'bg-destructive'
    else if (pct >= 75) barColor = 'bg-amber-500'
  }

  return (
    <>
      {hasQuota ? (
        <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
          <div
            className={`h-full transition-[width] duration-500 ease-out ${barColor}`}
            style={{ width: `${pct ?? 0}%` }}
          />
        </div>
      ) : (
        <div className="h-2 w-full rounded-full bg-muted">
          <div className="h-full w-1/3 rounded-full bg-muted-foreground/30 animate-pulse" />
        </div>
      )}

      <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
        <span className="font-medium">
          {formatBytes(usedBytes)}
          {hasQuota && (
            <>
              {' '}
              / <span className="text-muted-foreground">{formatBytes(quotaBytes as number)}</span>
            </>
          )}
        </span>
        <span className="text-muted-foreground">
          {hasQuota ? `${pct?.toFixed(1)}%` : 'no quota set'}
          {objectCount > 0 && ` · ${objectCount.toLocaleString()} objects`}
          {partial && ' (partial)'}
        </span>
      </div>

      {note && <p className="text-[11px] text-muted-foreground italic">{note}</p>}
    </>
  )
}
