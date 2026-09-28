import { formatDistanceToNow } from 'date-fns'
import { CheckCircle2, Clock, PlayCircle, XCircle, Zap } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { getCronEngineStatus, runCronJobNow, saveCronEngine } from '@/lib/actions/integrations'
import { useApiMutation, useApiQuery } from '@/lib/query'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card'
import { Label } from '@/shared/components/ui/label'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { Switch } from '@/shared/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table'

const CRON_ENGINE_KEY = ['integrations', 'cron-engine'] as const

/**
 * A failed run's message can be enormous (a failed query including its
 * parameters). Shown whole, that one unbroken string stretched the jobs table
 * past the screen and pushed the Run buttons out of view — show a short
 * preview; the full text stays in the job-run record.
 */
const ERROR_PREVIEW_CHARS = 200
function errorPreview(message: string): string {
  return message.length > ERROR_PREVIEW_CHARS
    ? `${message.slice(0, ERROR_PREVIEW_CHARS)}…`
    : message
}

export function CronEngineConfigCard() {
  const query = useApiQuery(CRON_ENGINE_KEY, getCronEngineStatus)
  const status = query.data ?? null
  const loading = query.isLoading

  const saveMutation = useApiMutation(saveCronEngine, { invalidates: [CRON_ENGINE_KEY] })
  const [running, setRunning] = useState<string | null>(null)
  const saving = saveMutation.isPending

  async function toggleNodeCron(next: boolean) {
    if (!status) return
    try {
      await saveMutation.mutateAsync({ nodeCronEnabled: next })
      toast.success(`node-cron ${next ? 'enabled' : 'disabled'}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save')
    }
  }

  async function toggleQStash(next: boolean) {
    if (!status) return
    try {
      await saveMutation.mutateAsync({ qstashEnabled: next })
      toast.success(
        next
          ? 'QStash enabled — schedules will sync to Upstash'
          : 'QStash disabled — local schedules left in place'
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save')
    }
  }

  async function runNow(jobId: string) {
    setRunning(jobId)
    const res = await runCronJobNow(jobId)
    setRunning(null)
    if (res.success) {
      toast.success(`${jobId}: ${res.data?.summary ?? 'ok'}`)
      query.refetch()
    } else {
      toast.error(res.data?.error || res.error || 'Run failed')
    }
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Cron Engine
          </CardTitle>
          <CardDescription>
            Pick which scheduler(s) fire registered jobs. node-cron runs in-process — good for local
            dev and single-instance prod. QStash runs externally — good for serverless and
            multi-instance prod. Both on at once is fine; the Redis lock prevents double-firing.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {status?.config.bootError && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              Cron engine failed to start: {status.config.bootError}
            </div>
          )}
          {loading ? (
            <Skeleton className="h-20 w-full" />
          ) : status ? (
            <>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="flex items-start justify-between gap-3 rounded-md border p-3">
                  <div>
                    <Label className="text-sm font-medium">node-cron (in-process)</Label>
                    <p className="text-xs text-muted-foreground">
                      Runs inside this backend process. Restart-resilient only as long as the
                      process is alive.
                    </p>
                  </div>
                  <Switch
                    checked={status.config.nodeCronEnabled}
                    onCheckedChange={toggleNodeCron}
                    disabled={saving}
                  />
                </div>
                <div className="flex items-start justify-between gap-3 rounded-md border p-3">
                  <div>
                    <Label className="text-sm font-medium">QStash (Upstash)</Label>
                    <p className="text-xs text-muted-foreground">
                      Durable external scheduler. Requires Upstash creds + a public base URL.
                    </p>
                  </div>
                  <Switch
                    checked={status.config.qstashEnabled}
                    onCheckedChange={toggleQStash}
                    disabled={saving}
                  />
                </div>
              </div>

              <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                Internal secret for manual triggers:{' '}
                <span className="font-mono">
                  {status.config.internalSecretMasked ?? '(auto-generated on first save)'}
                </span>
              </div>
            </>
          ) : (
            <p className="text-sm text-destructive">Could not load cron engine config.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Registered jobs</CardTitle>
          <CardDescription>
            Every scheduled task in the system. "Run now" fires the job out-of-band — useful for
            sanity-checking before flipping the engine on in prod.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Job</TableHead>
                  <TableHead className="w-32">Schedule</TableHead>
                  <TableHead className="w-40">Last run</TableHead>
                  <TableHead className="w-40">Next run</TableHead>
                  <TableHead className="w-28">Status</TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(status?.jobs ?? []).map((j) => (
                  <TableRow key={j.id}>
                    <TableCell>
                      <div className="font-mono text-xs font-medium">{j.id}</div>
                      <p className="text-xs text-muted-foreground">{j.description}</p>
                      {j.lastRun?.summary && <p className="text-xs mt-1">{j.lastRun.summary}</p>}
                      {j.lastRun?.errorMessage && (
                        <p className="text-xs text-destructive mt-1 break-all">
                          {errorPreview(j.lastRun.errorMessage)}
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{j.cron}</TableCell>
                    <TableCell className="text-xs">
                      {j.lastRun
                        ? `${formatDistanceToNow(new Date(j.lastRun.startedAt))} ago (${j.lastRun.source})`
                        : '—'}
                    </TableCell>
                    <TableCell className="text-xs">
                      {j.nextRuns && j.nextRuns.length > 0 ? (
                        <div>
                          <div>in {formatDistanceToNow(new Date(j.nextRuns[0]))}</div>
                          {j.nextRuns.length > 1 && (
                            <div className="text-muted-foreground">
                              then{' '}
                              {j.nextRuns
                                .slice(1)
                                .map((r) => formatDistanceToNow(new Date(r)))
                                .join(', ')}
                            </div>
                          )}
                        </div>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell>
                      {!j.lastRun ? (
                        <Badge variant="outline">never</Badge>
                      ) : j.lastRun.status === 'success' ? (
                        <Badge variant="success">
                          <CheckCircle2 className="h-3 w-3 mr-1" />
                          success
                        </Badge>
                      ) : j.lastRun.status === 'failed' ? (
                        <Badge variant="destructive">
                          <XCircle className="h-3 w-3 mr-1" />
                          failed
                        </Badge>
                      ) : (
                        <Badge variant="secondary">{j.lastRun.status}</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => runNow(j.id)}
                        disabled={running !== null}
                      >
                        {running === j.id ? (
                          'Running…'
                        ) : (
                          <>
                            <PlayCircle className="h-3 w-3 mr-1" />
                            Run
                          </>
                        )}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {status?.qstash && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Zap className="h-5 w-5" />
              QStash pipeline
            </CardTitle>
            <CardDescription>
              {status.qstash.configured ? (
                <>
                  Live state from Upstash QStash — what's actually queued for delivery to this
                  backend, plus the schedules QStash is firing against. Mirrors what
                  console.upstash.com shows.
                </>
              ) : (
                <>
                  QStash not configured. Add credentials in Upstash settings to see the live queue.
                </>
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!status.qstash.configured ? (
              <p className="text-sm text-muted-foreground">
                The "Next run" column above still works — it's computed from the cron expression.
              </p>
            ) : status.qstash.error ? (
              <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3">
                <p className="text-xs font-medium text-destructive">Could not reach QStash</p>
                <p className="text-xs mt-1">{status.qstash.error}</p>
              </div>
            ) : (
              <>
                <section className="space-y-2">
                  <h4 className="text-sm font-semibold">
                    Active schedules ({status.qstash.schedules.length})
                  </h4>
                  {status.qstash.schedules.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      No QStash schedules yet. Enable QStash above — schedules sync on save.
                    </p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Job</TableHead>
                          <TableHead className="w-32">Cron</TableHead>
                          <TableHead className="w-40">Next fire (QStash)</TableHead>
                          <TableHead className="w-24">State</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {status.qstash.schedules.map((s) => (
                          <TableRow key={s.scheduleId}>
                            <TableCell className="font-mono text-xs">
                              {s.matchedJobId ?? (
                                <span className="text-destructive">orphan ({s.destination})</span>
                              )}
                            </TableCell>
                            <TableCell className="font-mono text-xs">{s.cron}</TableCell>
                            <TableCell className="text-xs">
                              {s.nextScheduleTime
                                ? `in ${formatDistanceToNow(new Date(s.nextScheduleTime))}`
                                : `created ${formatDistanceToNow(new Date(s.createdAt))} ago`}
                            </TableCell>
                            <TableCell>
                              {s.isPaused ? (
                                <Badge variant="outline">paused</Badge>
                              ) : (
                                <Badge variant="success">active</Badge>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </section>

                <section className="space-y-2 border-t pt-4">
                  <h4 className="text-sm font-semibold">
                    Recent delivery events ({status.qstash.events.length})
                  </h4>
                  {status.qstash.events.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      Nothing in the feed yet. QStash starts recording events the first time a
                      schedule fires.
                    </p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Target</TableHead>
                          <TableHead className="w-40">When</TableHead>
                          <TableHead className="w-28">State</TableHead>
                          <TableHead>Note</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {status.qstash.events.slice(0, 30).map((e) => {
                          const jobId = e.url.split('/api/internal/cron/')[1] ?? e.url
                          const stateVariant: 'success' | 'destructive' | 'secondary' | 'outline' =
                            e.state === 'DELIVERED'
                              ? 'success'
                              : e.state === 'FAILED'
                                ? 'destructive'
                                : e.state === 'RETRY'
                                  ? 'outline'
                                  : 'secondary'
                          return (
                            <TableRow key={`${e.messageId}-${e.time}-${e.state}`}>
                              <TableCell className="font-mono text-xs">{jobId}</TableCell>
                              <TableCell className="text-xs">
                                {formatDistanceToNow(new Date(e.time))} ago
                              </TableCell>
                              <TableCell>
                                <Badge variant={stateVariant}>{e.state}</Badge>
                              </TableCell>
                              <TableCell className="text-xs">
                                {e.error ? (
                                  <span className="text-destructive">{e.error}</span>
                                ) : e.nextDeliveryTime ? (
                                  `retry in ${formatDistanceToNow(new Date(e.nextDeliveryTime))}`
                                ) : (
                                  ''
                                )}
                              </TableCell>
                            </TableRow>
                          )
                        })}
                      </TableBody>
                    </Table>
                  )}
                </section>
              </>
            )}
          </CardContent>
        </Card>
      )}
    </>
  )
}
