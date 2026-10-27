import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@denel/ui'
import { format, parseISO } from 'date-fns'
import { Clock } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  type AttendanceSubmission,
  approveAttendanceSubmission,
  getAttendanceSubmissions,
  rejectAttendanceSubmission,
} from '@/lib/actions/staff'

export function AttendanceSubmissionsSection() {
  const [submissions, setSubmissions] = useState<AttendanceSubmission[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await getAttendanceSubmissions()
    if (res.success) {
      setSubmissions(res.data)
    } else {
      toast.error(res.error || 'Failed to load submissions')
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function handleApprove(id: string) {
    const res = await approveAttendanceSubmission(id)
    if (res.success) {
      toast.success('Submission approved and attendance updated')
      await load()
    } else {
      toast.error('Failed to approve')
    }
  }

  async function handleReject(id: string) {
    const res = await rejectAttendanceSubmission(id)
    if (res.success) {
      toast.success('Submission rejected')
      await load()
    } else {
      toast.error('Failed to reject')
    }
  }

  const pending = submissions.filter((s) => s.status === 'pending')
  const resolved = submissions.filter((s) => s.status !== 'pending')

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Pending Fix Requests</CardTitle>
          <CardDescription>
            Staff have requested manual fixes to their clock-in or clock-out times. Approving these
            requests will update their attendance records.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-muted-foreground">Loading...</p>
          ) : pending.length === 0 ? (
            <p className="text-muted-foreground text-sm">No pending requests.</p>
          ) : (
            <div className="space-y-4">
              {pending.map((s) => (
                <div key={s.id} className="flex flex-col gap-2 p-4 border rounded-md bg-muted/20">
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="font-semibold">{s.staffName}</p>
                      <p className="text-sm text-muted-foreground">
                        {format(parseISO(s.date), 'EEEE, MMM do, yyyy')}
                      </p>
                    </div>
                    <Badge variant="outline" className="uppercase text-[10px]">
                      {s.punchType.replace('_', ' ')}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2 text-sm mt-1">
                    <Clock className="h-4 w-4 text-muted-foreground" />
                    <span className="font-mono">{s.time}</span>
                  </div>
                  {s.reason && (
                    <p className="text-sm italic text-muted-foreground mt-2 border-l-2 pl-2">
                      "{s.reason}"
                    </p>
                  )}
                  <div className="flex items-center gap-2 mt-4 justify-end">
                    <Button variant="outline" size="sm" onClick={() => handleReject(s.id)}>
                      Reject
                    </Button>
                    <Button size="sm" onClick={() => handleApprove(s.id)}>
                      Approve & Update
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Resolved Requests</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-muted-foreground">Loading...</p>
          ) : resolved.length === 0 ? (
            <p className="text-muted-foreground text-sm">No resolved requests.</p>
          ) : (
            <div className="space-y-4">
              {resolved.slice(0, 20).map((s) => (
                <div key={s.id} className="flex justify-between items-center p-3 border rounded-md">
                  <div>
                    <p className="font-semibold text-sm">{s.staffName}</p>
                    <p className="text-xs text-muted-foreground">
                      {format(parseISO(s.date), 'MMM d, yyyy')} · {s.punchType.replace('_', ' ')} at{' '}
                      {s.time}
                    </p>
                  </div>
                  <Badge variant={s.status === 'approved' ? 'default' : 'secondary'}>
                    {s.status}
                  </Badge>
                </div>
              ))}
              {resolved.length > 20 && (
                <p className="text-xs text-muted-foreground text-center">
                  Showing latest 20 resolved requests.
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
