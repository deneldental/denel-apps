import { format, formatDistanceToNow } from 'date-fns'
import {
  Activity,
  Check,
  Clock,
  Copy,
  Download,
  Edit,
  Eye,
  FileCode,
  FileText,
  Filter,
  Globe,
  Laptop,
  Layers,
  Lock,
  LockOpen,
  LogIn,
  LogOut,
  Plus,
  Shield,
  Trash2,
  Upload,
  User,
} from 'lucide-react'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

export type AuditLog = {
  id: string
  action: string
  module: string
  entityId: string | null
  entityName: string | null
  changes: unknown
  beforeJson?: Record<string, unknown> | null
  afterJson?: Record<string, unknown> | null
  changedFields?: string[] | null
  reason?: string | null
  ipAddress: string | null
  userAgent: string | null
  createdAt: string | Date
  user: {
    id: string
    name: string | null
    email: string | null
  } | null
}

const actionStyles: Record<
  string,
  { bg: string; text: string; border: string; icon: React.ComponentType<{ className?: string }> }
> = {
  create: {
    bg: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    border: 'border-emerald-500/30',
    text: 'text-emerald-700 dark:text-emerald-300',
    icon: Plus,
  },
  update: {
    bg: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
    border: 'border-blue-500/30',
    text: 'text-blue-700 dark:text-blue-300',
    icon: Edit,
  },
  delete: {
    bg: 'bg-rose-500/10 text-rose-600 dark:text-rose-400',
    border: 'border-rose-500/30',
    text: 'text-rose-700 dark:text-rose-300',
    icon: Trash2,
  },
  login: {
    bg: 'bg-purple-500/10 text-purple-600 dark:text-purple-400',
    border: 'border-purple-500/30',
    text: 'text-purple-700 dark:text-purple-300',
    icon: LogIn,
  },
  logout: {
    bg: 'bg-slate-500/10 text-slate-600 dark:text-slate-400',
    border: 'border-slate-500/30',
    text: 'text-slate-700 dark:text-slate-300',
    icon: LogOut,
  },
  view: {
    bg: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400',
    border: 'border-cyan-500/30',
    text: 'text-cyan-700 dark:text-cyan-300',
    icon: Eye,
  },
  export: {
    bg: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
    border: 'border-amber-500/30',
    text: 'text-amber-700 dark:text-amber-300',
    icon: Download,
  },
  upload: {
    bg: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400',
    border: 'border-indigo-500/30',
    text: 'text-indigo-700 dark:text-indigo-300',
    icon: Upload,
  },
  download: {
    bg: 'bg-pink-500/10 text-pink-600 dark:text-pink-400',
    border: 'border-pink-500/30',
    text: 'text-pink-700 dark:text-pink-300',
    icon: Download,
  },
  lock: {
    bg: 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400',
    border: 'border-yellow-500/30',
    text: 'text-yellow-700 dark:text-yellow-300',
    icon: Lock,
  },
  unlock: {
    bg: 'bg-lime-500/10 text-lime-600 dark:text-lime-400',
    border: 'border-lime-500/30',
    text: 'text-lime-700 dark:text-lime-300',
    icon: LockOpen,
  },
}

export function formatModule(module: string): string {
  return module
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

export function getActionStyle(action: string) {
  const normalized = action.toLowerCase()
  return (
    actionStyles[normalized] || {
      bg: 'bg-gray-500/10 text-gray-600 dark:text-gray-400',
      border: 'border-gray-500/30',
      text: 'text-gray-700 dark:text-gray-300',
      icon: Activity,
    }
  )
}

function CopyableValue({ value }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation()
    navigator.clipboard.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      title="Click to copy"
      className="group inline-flex items-center gap-1.5 font-mono text-xs hover:text-primary transition-colors text-left"
    >
      <span className="truncate max-w-[280px]">{value}</span>
      {copied ? (
        <Check className="h-3 w-3 text-emerald-500 shrink-0" />
      ) : (
        <Copy className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 text-muted-foreground" />
      )}
    </button>
  )
}

function DiffRow({ field, before, after }: { field: string; before: unknown; after: unknown }) {
  const formatVal = (val: unknown) => {
    if (val === null || val === undefined)
      return <span className="italic text-muted-foreground/60">null</span>
    if (typeof val === 'boolean') return <span>{val ? 'true' : 'false'}</span>
    if (typeof val === 'object')
      return <pre className="text-[11px] whitespace-pre-wrap">{JSON.stringify(val, null, 2)}</pre>
    return <span>{String(val)}</span>
  }

  return (
    <div className="grid grid-cols-12 gap-2 py-2 px-2.5 rounded text-xs border-b border-border/50 hover:bg-muted/40 transition-colors">
      <div className="col-span-4 font-mono font-medium text-foreground truncate" title={field}>
        {field}
      </div>
      <div className="col-span-4 text-muted-foreground break-all bg-rose-500/5 dark:bg-rose-950/20 text-rose-700 dark:text-rose-300 p-1.5 rounded border border-rose-500/10">
        {formatVal(before)}
      </div>
      <div className="col-span-4 break-all bg-emerald-500/5 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-300 p-1.5 rounded border border-emerald-500/10">
        {formatVal(after)}
      </div>
    </div>
  )
}

export interface AuditLogDetailSheetProps {
  log: AuditLog | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onFilterByEntity?: (entityId: string) => void
}

export function AuditLogDetailSheet({
  log,
  open,
  onOpenChange,
  onFilterByEntity,
}: AuditLogDetailSheetProps) {
  if (!log) return null

  const actionStyle = getActionStyle(log.action)
  const ActionIcon = actionStyle.icon
  const dateObj = new Date(log.createdAt)
  const formattedFullDate = format(dateObj, 'PPpp')
  const relativeTime = formatDistanceToNow(dateObj, { addSuffix: true })

  const copyFullJson = () => {
    navigator.clipboard.writeText(JSON.stringify(log, null, 2))
  }

  const hasStructuredDiff =
    (log.beforeJson && typeof log.beforeJson === 'object') ||
    (log.afterJson && typeof log.afterJson === 'object')

  const diffKeys = Array.from(
    new Set([
      ...Object.keys(log.beforeJson || {}),
      ...Object.keys(log.afterJson || {}),
      ...(log.changedFields || []),
    ])
  ).sort()

  const changesObj =
    log.changes && typeof log.changes === 'object' && !Array.isArray(log.changes)
      ? (log.changes as Record<string, unknown>)
      : null

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl p-0 flex flex-col h-full bg-background">
        {/* Header */}
        <div className="p-6 border-b border-border space-y-3 bg-muted/20">
          <div className="flex items-center justify-between gap-3 pr-6">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge
                variant="outline"
                className={`capitalize font-semibold gap-1.5 px-2.5 py-1 ${actionStyle.bg} ${actionStyle.border}`}
              >
                <ActionIcon className="h-3.5 w-3.5" />
                {log.action}
              </Badge>
              <Badge variant="secondary" className="font-medium">
                {formatModule(log.module)}
              </Badge>
              {log.entityName && (
                <span
                  className="text-sm font-semibold text-foreground truncate max-w-[200px]"
                  title={log.entityName}
                >
                  {log.entityName}
                </span>
              )}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={copyFullJson}
              className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              <FileCode className="h-3.5 w-3.5" />
              Copy JSON
            </Button>
          </div>

          <div>
            <SheetTitle className="text-lg font-bold flex items-center gap-2">
              <span>{formatModule(log.module)} Audit Event</span>
            </SheetTitle>
            <SheetDescription className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
              <Clock className="h-3.5 w-3.5" />
              <span title={dateObj.toISOString()}>{formattedFullDate}</span>
              <span>•</span>
              <span>{relativeTime}</span>
            </SheetDescription>
          </div>
        </div>

        {/* Body Content */}
        <ScrollArea className="flex-1 p-6">
          <div className="space-y-6">
            {/* Action Bar / Quick Filter */}
            {log.entityId && onFilterByEntity && (
              <div className="flex items-center justify-between p-3 rounded-lg border border-primary/20 bg-primary/5">
                <div className="text-xs">
                  <span className="text-muted-foreground">Entity Target: </span>
                  <span className="font-semibold text-foreground">
                    {log.entityName || log.entityId}
                  </span>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    if (log.entityId) {
                      onFilterByEntity(log.entityId)
                      onOpenChange(false)
                    }
                  }}
                  className="h-7 text-xs gap-1.5 border-primary/30 text-primary hover:bg-primary/10"
                >
                  <Filter className="h-3 w-3" />
                  Filter to this entity
                </Button>
              </div>
            )}

            {/* Overview Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Actor Card */}
              <div className="p-4 rounded-lg border border-border bg-card space-y-3">
                <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  <User className="h-3.5 w-3.5 text-primary" />
                  Actor Details
                </div>
                <div className="space-y-2 text-xs">
                  <div>
                    <span className="text-muted-foreground block text-[11px]">User Name</span>
                    <span className="font-medium text-foreground text-sm">
                      {log.user?.name || 'System / Automated'}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block text-[11px]">Email</span>
                    <span className="text-muted-foreground">{log.user?.email || 'N/A'}</span>
                  </div>
                  {log.user?.id && (
                    <div>
                      <span className="text-muted-foreground block text-[11px]">User ID</span>
                      <CopyableValue value={log.user.id} label="User ID" />
                    </div>
                  )}
                </div>
              </div>

              {/* Target & Session Card */}
              <div className="p-4 rounded-lg border border-border bg-card space-y-3">
                <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  <Globe className="h-3.5 w-3.5 text-primary" />
                  Target & Session
                </div>
                <div className="space-y-2 text-xs">
                  <div>
                    <span className="text-muted-foreground block text-[11px]">
                      Module / Resource
                    </span>
                    <span className="font-medium text-foreground">{formatModule(log.module)}</span>
                  </div>
                  {log.entityId && (
                    <div>
                      <span className="text-muted-foreground block text-[11px]">Entity ID</span>
                      <CopyableValue value={log.entityId} label="Entity ID" />
                    </div>
                  )}
                  {log.ipAddress && (
                    <div>
                      <span className="text-muted-foreground block text-[11px]">IP Address</span>
                      <CopyableValue value={log.ipAddress} label="IP Address" />
                    </div>
                  )}
                  <div>
                    <span className="text-muted-foreground block text-[11px]">Log ID</span>
                    <CopyableValue value={log.id} label="Log ID" />
                  </div>
                </div>
              </div>
            </div>

            {/* Reason Note (if any) */}
            {log.reason && (
              <div className="p-3.5 rounded-lg border border-amber-500/20 bg-amber-500/5 space-y-1">
                <div className="text-xs font-semibold text-amber-800 dark:text-amber-300 flex items-center gap-1.5">
                  <Shield className="h-3.5 w-3.5" />
                  Audit Reason / Note
                </div>
                <p className="text-xs text-amber-900/90 dark:text-amber-200/90 leading-relaxed">
                  {log.reason}
                </p>
              </div>
            )}

            {/* Changed Fields Tags */}
            {log.changedFields && log.changedFields.length > 0 && (
              <div className="space-y-2">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                  <Layers className="h-3.5 w-3.5 text-primary" />
                  Modified Fields ({log.changedFields.length})
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {log.changedFields.map((field) => (
                    <Badge key={field} variant="outline" className="font-mono text-xs bg-muted/40">
                      {field}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Tabs for Changes / Diffs */}
            <Tabs defaultValue="diff" className="w-full">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="diff" className="text-xs gap-1.5">
                  <FileText className="h-3.5 w-3.5" />
                  Changes & State
                </TabsTrigger>
                <TabsTrigger value="raw" className="text-xs gap-1.5">
                  <FileCode className="h-3.5 w-3.5" />
                  Raw JSON Payload
                </TabsTrigger>
              </TabsList>

              <TabsContent value="diff" className="mt-4 space-y-3">
                {hasStructuredDiff && diffKeys.length > 0 ? (
                  <div className="rounded-lg border border-border overflow-hidden">
                    <div className="grid grid-cols-12 gap-2 py-2 px-3 bg-muted/60 text-[11px] font-semibold text-muted-foreground border-b border-border">
                      <div className="col-span-4">Field</div>
                      <div className="col-span-4">Before (Previous)</div>
                      <div className="col-span-4">After (New)</div>
                    </div>
                    <div className="divide-y divide-border/40 max-h-[320px] overflow-y-auto">
                      {diffKeys.map((key) => (
                        <DiffRow
                          key={key}
                          field={key}
                          before={
                            log.beforeJson
                              ? (log.beforeJson as Record<string, unknown>)[key]
                              : undefined
                          }
                          after={
                            log.afterJson
                              ? (log.afterJson as Record<string, unknown>)[key]
                              : undefined
                          }
                        />
                      ))}
                    </div>
                  </div>
                ) : changesObj && Object.keys(changesObj).length > 0 ? (
                  <div className="rounded-lg border border-border p-3 bg-card space-y-2">
                    <span className="text-xs font-semibold text-muted-foreground">
                      Changes Record
                    </span>
                    <div className="space-y-1.5">
                      {Object.entries(changesObj).map(([key, val]) => (
                        <div
                          key={key}
                          className="flex items-start justify-between gap-4 py-1 border-b border-border/40 text-xs last:border-b-0"
                        >
                          <span className="font-mono font-medium text-foreground shrink-0">
                            {key}
                          </span>
                          <span className="text-right text-muted-foreground font-mono truncate max-w-[280px]">
                            {typeof val === 'object' ? JSON.stringify(val) : String(val)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="p-6 text-center rounded-lg border border-dashed border-border text-muted-foreground text-xs">
                    <Activity className="h-6 w-6 mx-auto mb-2 opacity-40" />
                    No state modifications recorded for this event.
                  </div>
                )}
              </TabsContent>

              <TabsContent value="raw" className="mt-4">
                <div className="relative rounded-lg border border-border bg-muted/30 p-3.5">
                  <pre className="text-xs font-mono overflow-x-auto text-foreground leading-relaxed max-h-[380px]">
                    {JSON.stringify(log, null, 2)}
                  </pre>
                </div>
              </TabsContent>
            </Tabs>

            {/* Technical User Agent */}
            {log.userAgent && (
              <div className="p-3 rounded-lg border border-border/60 bg-muted/10 space-y-1">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Laptop className="h-3 w-3" />
                  <span className="font-semibold text-[11px] uppercase tracking-wider">
                    User Agent
                  </span>
                </div>
                <p className="text-xs font-mono text-muted-foreground/90 break-all leading-relaxed">
                  {log.userAgent}
                </p>
              </div>
            )}
          </div>
        </ScrollArea>

        {/* Sticky Full-Width Action Footer */}
        <div className="shrink-0 border-t border-border bg-background p-4">
          <div className="grid grid-cols-2 gap-3 w-full">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="w-full"
            >
              Close
            </Button>
            {log.entityId && onFilterByEntity ? (
              <Button
                type="button"
                onClick={() => {
                  if (log.entityId) {
                    onFilterByEntity(log.entityId)
                    onOpenChange(false)
                  }
                }}
                className="w-full gap-1.5"
              >
                <Filter className="h-3.5 w-3.5" />
                Filter this Entity
              </Button>
            ) : (
              <Button type="button" onClick={copyFullJson} className="w-full gap-1.5">
                <FileCode className="h-3.5 w-3.5" />
                Copy Full JSON
              </Button>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
