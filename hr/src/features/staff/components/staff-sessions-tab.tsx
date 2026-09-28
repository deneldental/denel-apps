import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@denel/ui'
import { formatDistanceToNow } from 'date-fns'
import { Loader2, LogOut, Monitor, Smartphone } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { getStaffSessions, revokeStaffSession, type StaffSession } from '@/lib/actions/staff'
import { StatusBadge } from '@/shared/components/status-badge'

/** Best-effort friendly label from a raw User-Agent string. */
function describeDevice(ua: string | null): { label: string; mobile: boolean } {
  if (!ua) return { label: 'Unknown device', mobile: false }
  const mobile = /Mobile|Android|iPhone|iPad|iPod/i.test(ua)
  let os = 'Unknown OS'
  if (/Windows/i.test(ua)) os = 'Windows'
  else if (/iPhone|iPad|iPod/i.test(ua)) os = 'iOS'
  else if (/Android/i.test(ua)) os = 'Android'
  else if (/Mac OS X|Macintosh/i.test(ua)) os = 'macOS'
  else if (/Linux/i.test(ua)) os = 'Linux'
  let browser = 'Browser'
  if (/Edg\//i.test(ua)) browser = 'Edge'
  else if (/OPR\/|Opera/i.test(ua)) browser = 'Opera'
  else if (/Chrome\//i.test(ua)) browser = 'Chrome'
  else if (/Firefox\//i.test(ua)) browser = 'Firefox'
  else if (/Safari\//i.test(ua)) browser = 'Safari'
  return { label: `${browser} · ${os}`, mobile }
}

function timeAgo(iso: string): string {
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true })
  } catch {
    return '—'
  }
}

export function StaffSessionsTab({ staffId }: { staffId: string }) {
  const [sessions, setSessions] = useState<StaffSession[]>([])
  const [loading, setLoading] = useState(true)
  const [revoking, setRevoking] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await getStaffSessions(staffId)
    if (res.success) setSessions(res.data)
    else toast.error(res.error || 'Failed to load sessions')
    setLoading(false)
  }, [staffId])

  useEffect(() => {
    void load()
  }, [load])

  async function handleRevoke(sessionId: string) {
    setRevoking(sessionId)
    const res = await revokeStaffSession(staffId, sessionId)
    setRevoking(null)
    if (res.success) {
      toast.success('Session revoked')
      setSessions((prev) => prev.filter((s) => s.id !== sessionId))
    } else {
      toast.error(res.error || 'Failed to revoke session')
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Team app sessions</CardTitle>
        <CardDescription>
          Active logins for this staff member in the Team app (phone + OTP). Revoke a session to
          sign that device out — e.g. a lost or shared phone.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="py-12 text-center text-muted-foreground">
            <Loader2 className="mx-auto h-5 w-5 animate-spin" />
          </div>
        ) : sessions.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            No active Team app sessions. This staff isn&apos;t signed in on any device.
          </div>
        ) : (
          <div className="divide-y rounded-md border">
            {sessions.map((s) => {
              const device = describeDevice(s.userAgent)
              const Icon = device.mobile ? Smartphone : Monitor
              return (
                <div key={s.id} className="flex items-center gap-4 p-4">
                  <Icon className="h-5 w-5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-medium">{device.label}</p>
                      <StatusBadge tone="success" className="h-4 px-1.5 text-[10px] normal-case">
                        Active
                      </StatusBadge>
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Last used {timeAgo(s.lastUsedAt)}
                      {s.ipAddress ? ` · ${s.ipAddress}` : ''}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Signed in {new Date(s.createdAt).toLocaleString()} · expires{' '}
                      {new Date(s.expiresAt).toLocaleDateString()}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0 gap-1.5 text-destructive"
                    disabled={revoking === s.id}
                    onClick={() => handleRevoke(s.id)}
                  >
                    {revoking === s.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <LogOut className="h-3.5 w-3.5" />
                    )}
                    Revoke
                  </Button>
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
