import { useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  Globe,
  Loader2,
  Monitor,
  RefreshCw,
  Search,
  Shield,
  ShieldOff,
  Smartphone,
  Trash2,
  X,
} from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import {
  deletePatientSession,
  listPatientPwa,
  listPatientSessions,
  type PatientPwaRow,
  type PatientSession,
  revokePatientPwa,
  revokePatientSessions,
} from '@/lib/actions/access-management'
import { useApiMutation, useApiQuery } from '@/lib/query'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import { Input } from '@/shared/components/ui/input'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/shared/components/ui/sheet'

// ── Helpers ───────────────────────────────────────────────────────────────────

function relativeTime(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const m = Math.floor(diff / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

function deviceIcon(ua: string | null) {
  if (!ua) return <Globe className="h-3.5 w-3.5 text-muted-foreground" />
  const lower = ua.toLowerCase()
  if (lower.includes('mobile') || lower.includes('android') || lower.includes('iphone'))
    return <Smartphone className="h-3.5 w-3.5 text-muted-foreground" />
  return <Monitor className="h-3.5 w-3.5 text-muted-foreground" />
}

function truncateUA(ua: string | null) {
  if (!ua) return '—'
  // Strip version noise: "Mozilla/5.0 (iPhone; …) AppleWebKit/…" → just the useful bit
  const match = ua.match(/\(([^)]+)\)/)
  return match ? match[1].split(';')[0].trim() : ua.slice(0, 40)
}

// ── Session sheet ─────────────────────────────────────────────────────────────

function SessionSheet({
  patient,
  open,
  onOpenChange,
  onRevoked,
}: {
  patient: PatientPwaRow | null
  open: boolean
  onOpenChange: (v: boolean) => void
  onRevoked: () => void
}) {
  const queryClient = useQueryClient()
  const [killing, setKilling] = useState<string | null>(null)
  const [killAll, setKillAll] = useState(false)

  const sessionsKey = ['access-management', 'patient-sessions', patient?.id ?? null] as const

  const { data: sessions = [], isLoading: loading } = useApiQuery(
    sessionsKey,
    () => listPatientSessions(patient!.id),
    { enabled: open && !!patient }
  )

  async function handleDeleteSession(sessionId: string) {
    setKilling(sessionId)
    const res = await deletePatientSession(sessionId)
    setKilling(null)
    if (res.success) {
      toast.success('Session revoked.')
      queryClient.setQueryData<PatientSession[]>(sessionsKey, (prev) =>
        (prev ?? []).filter((s) => s.id !== sessionId)
      )
    } else {
      toast.error(res.error ?? 'Failed to revoke session')
    }
  }

  async function handleKillAll() {
    if (!patient) return
    setKillAll(true)
    const res = await revokePatientSessions(patient.id)
    setKillAll(false)
    if (res.success) {
      toast.success(`${res.data?.killedSessions ?? 0} session(s) revoked.`)
      queryClient.setQueryData<PatientSession[]>(sessionsKey, [])
      onRevoked()
    } else {
      toast.error(res.error ?? 'Failed to kill sessions')
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[480px] sm:max-w-[480px] flex flex-col gap-0">
        <SheetHeader className="pb-4 border-b">
          <SheetTitle className="flex items-center gap-2">
            <Shield className="h-4 w-4" />
            Active sessions
          </SheetTitle>
          <SheetDescription>
            {patient?.name} — {patient?.patientId ?? patient?.id.slice(0, 8)}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto py-4 space-y-2">
          {loading ? (
            <div className="flex h-24 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : sessions.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No active sessions.</p>
          ) : (
            sessions.map((s) => (
              <div key={s.id} className="flex items-center gap-3 rounded-lg border p-3 text-sm">
                {deviceIcon(s.userAgent)}
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{truncateUA(s.userAgent)}</p>
                  <p className="text-xs text-muted-foreground">
                    {s.ipAddress ?? 'Unknown IP'} · last seen {relativeTime(s.lastUsedAt)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Expires {new Date(s.expiresAt).toLocaleDateString('en-GB')}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-destructive hover:text-destructive shrink-0"
                  disabled={killing === s.id}
                  onClick={() => handleDeleteSession(s.id)}
                  title="Revoke this session"
                  aria-label="Revoke this session"
                >
                  {killing === s.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <X className="h-3.5 w-3.5" />
                  )}
                </Button>
              </div>
            ))
          )}
        </div>

        {sessions.length > 0 && (
          <div className="border-t pt-4">
            <Button
              variant="destructive"
              size="sm"
              className="w-full"
              disabled={killAll}
              onClick={handleKillAll}
            >
              {killAll ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              )}
              Kill all sessions ({sessions.length})
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

// ── Revoke confirm dialog ─────────────────────────────────────────────────────

function RevokeDialog({
  patient,
  open,
  onOpenChange,
  onRevoked,
}: {
  patient: PatientPwaRow | null
  open: boolean
  onOpenChange: (v: boolean) => void
  onRevoked: () => void
}) {
  const [submitting, setSubmitting] = useState(false)

  async function confirm() {
    if (!patient) return
    setSubmitting(true)
    const res = await revokePatientPwa(patient.id, 'Revoked via Access Management')
    setSubmitting(false)
    if (res.success) {
      toast.success(`PWA access revoked for ${patient.name}.`)
      onOpenChange(false)
      onRevoked()
    } else {
      toast.error(res.error ?? 'Failed to revoke PWA access')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <ShieldOff className="h-4 w-4" />
            Revoke PWA access
          </DialogTitle>
          <DialogDescription>
            This will disable <strong>{patient?.name}</strong>'s patient-portal login, clear their
            password hash, and kill all active sessions immediately. They will need to be re-granted
            access by a receptionist before they can log in again.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={confirm} disabled={submitting}>
            {submitting && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Revoke access
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Row ───────────────────────────────────────────────────────────────────────

function PatientRow({
  row,
  onViewSessions,
  onRevoke,
}: {
  row: PatientPwaRow
  onViewSessions: (row: PatientPwaRow) => void
  onRevoke: (row: PatientPwaRow) => void
}) {
  return (
    <tr className="border-t hover:bg-muted/10 transition-colors">
      <td className="py-3 pl-4 pr-2">
        <p className="font-medium text-sm">{row.name}</p>
        <p className="text-xs text-muted-foreground">{row.patientId ?? '—'}</p>
      </td>
      <td className="py-3 px-2 text-sm text-muted-foreground">{row.phone ?? '—'}</td>
      <td className="py-3 px-2">
        {row.activeSessionCount > 0 ? (
          <Badge variant="secondary" className="text-xs">
            {row.activeSessionCount} active
          </Badge>
        ) : (
          <span className="text-xs text-muted-foreground">None</span>
        )}
      </td>
      <td className="py-3 px-2 text-xs text-muted-foreground">
        {row.lastSession ? (
          <span className="flex items-center gap-1">
            {deviceIcon(row.lastSession.userAgent)}
            {relativeTime(row.lastSession.lastUsedAt as unknown as string)}
          </span>
        ) : (
          '—'
        )}
      </td>
      <td className="py-3 px-2 text-xs text-muted-foreground">
        {row.pwaAccessGrantedAt
          ? new Date(row.pwaAccessGrantedAt as unknown as string).toLocaleDateString('en-GB')
          : '—'}
        {row.grantedBy && (
          <span className="block text-muted-foreground/70">{row.grantedBy.name ?? '—'}</span>
        )}
      </td>
      <td className="py-3 pl-2 pr-4">
        <div className="flex items-center justify-end gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={() => onViewSessions(row)}
          >
            <Monitor className="mr-1 h-3 w-3" />
            Sessions
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-destructive hover:text-destructive"
            onClick={() => onRevoke(row)}
          >
            <ShieldOff className="mr-1 h-3 w-3" />
            Revoke
          </Button>
        </div>
      </td>
    </tr>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

const PAGE_SIZE = 50

export default function PatientPwaPage() {
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')

  const [sessionTarget, setSessionTarget] = useState<PatientPwaRow | null>(null)
  const [sessionOpen, setSessionOpen] = useState(false)
  const [revokeTarget, setRevokeTarget] = useState<PatientPwaRow | null>(null)
  const [revokeOpen, setRevokeOpen] = useState(false)

  const {
    data,
    isLoading: loading,
    refetch,
  } = useApiQuery(['access-management', 'patient-pwa', search, page], () =>
    listPatientPwa({ search: search || undefined, page, limit: PAGE_SIZE })
  )
  const rows = data?.rows ?? []
  const total = data?.total ?? 0

  function openSessions(row: PatientPwaRow) {
    setSessionTarget(row)
    setSessionOpen(true)
  }

  function openRevoke(row: PatientPwaRow) {
    setRevokeTarget(row)
    setRevokeOpen(true)
  }

  function handleRevoked() {
    refetch()
  }

  const totalPages = Math.ceil(total / PAGE_SIZE)

  return (
    <div className="flex flex-col gap-5 p-6">
      {/* Header + search */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold">Patient PWA access</h2>
          <p className="text-xs text-muted-foreground">
            Patients with portal login enabled — {total} total
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              className="pl-8 h-8 w-64 text-sm"
              placeholder="Name, patient ID, or phone…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setPage(1)
              }}
            />
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => refetch()}
            title="Refresh"
            aria-label="Refresh"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* Alert: warns when reading page > 1 */}
      {total === 0 && !loading && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {search ? 'No patients match your search.' : 'No patients have PWA access enabled yet.'}
        </div>
      )}

      {/* Table */}
      {(rows.length > 0 || loading) && (
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-muted/40 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <th className="text-left py-2.5 pl-4 pr-2">Patient</th>
                <th className="text-left py-2.5 px-2">Phone</th>
                <th className="text-left py-2.5 px-2">Sessions</th>
                <th className="text-left py-2.5 px-2">Last seen</th>
                <th className="text-left py-2.5 px-2">Granted</th>
                <th className="py-2.5 pl-2 pr-4" />
              </tr>
            </thead>
            <tbody>
              {loading
                ? Array.from({ length: 6 }).map((_, i) => (
                    <tr key={i} className="border-t">
                      <td colSpan={6} className="py-3 px-4">
                        <div className="h-4 w-full animate-pulse rounded bg-muted" />
                      </td>
                    </tr>
                  ))
                : rows.map((row) => (
                    <PatientRow
                      key={row.id}
                      row={row}
                      onViewSessions={openSessions}
                      onRevoke={openRevoke}
                    />
                  ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <p className="text-muted-foreground">
            Page {page} of {totalPages} ({total} patients)
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      {/* Session sheet */}
      <SessionSheet
        patient={sessionTarget}
        open={sessionOpen}
        onOpenChange={setSessionOpen}
        onRevoked={handleRevoked}
      />

      {/* Revoke confirm dialog */}
      <RevokeDialog
        patient={revokeTarget}
        open={revokeOpen}
        onOpenChange={setRevokeOpen}
        onRevoked={handleRevoked}
      />
    </div>
  )
}
