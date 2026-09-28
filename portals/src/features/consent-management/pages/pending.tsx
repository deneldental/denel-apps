import { formatDistanceToNow } from 'date-fns'
import { AlertTriangle, CalendarClock, ClipboardCheck, PenLine, ShieldAlert } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { getPendingConsents } from '@/lib/actions/consent-forms'
import { useApiQuery } from '@/lib/query'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
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

export default function ConsentPendingPage() {
  // Default scope (§18.2): patients with an upcoming appointment.
  const [upcomingOnly, setUpcomingOnly] = useState(true)

  // `getPendingConsents` carries an extra top-level `totalPending` alongside
  // `data` — fold both into one query-cached shape so neither gets dropped.
  const { data, isLoading: loading } = useApiQuery(
    ['consent-forms', 'pending', upcomingOnly],
    async () => {
      const res = await getPendingConsents({ upcomingOnly })
      return {
        success: res.success,
        error: res.error,
        data: { rows: res.data ?? [], totalPending: res.totalPending ?? 0 },
      }
    }
  )
  const rows = data?.rows ?? []
  const totalPending = data?.totalPending ?? 0

  const patientCount = rows.length

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
          <ShieldAlert className="h-7 w-7" />
          Pending Consents
        </h1>
        <p className="text-muted-foreground mt-1">
          Patients with required consent forms still unsigned before their procedure.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <CardTitle className="text-base">Consent Due</CardTitle>
            <Badge variant={totalPending > 0 ? 'destructive' : 'secondary'} className="gap-1">
              <AlertTriangle className="h-3 w-3" />
              {totalPending} outstanding
            </Badge>
            {patientCount > 0 && (
              <span className="text-xs text-muted-foreground">
                across {patientCount} {patientCount === 1 ? 'patient' : 'patients'}
              </span>
            )}
          </div>
          <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
            <Switch
              checked={upcomingOnly}
              onCheckedChange={setUpcomingOnly}
              aria-label="Limit to patients with an upcoming appointment"
            />
            Upcoming appointments only
          </label>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
              <ClipboardCheck className="h-10 w-10 text-emerald-500" />
              <p className="text-sm font-medium">No pending consents</p>
              <p className="text-xs text-muted-foreground">
                {upcomingOnly
                  ? 'Every patient with an upcoming appointment has signed all required consents.'
                  : 'Every patient has signed all required consents.'}
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Patient</TableHead>
                  <TableHead>Next Appointment</TableHead>
                  <TableHead>Outstanding Consents</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((patient) => (
                  <TableRow key={patient.patientId} className="align-top">
                    <TableCell className="font-medium text-sm whitespace-nowrap">
                      {patient.patientName}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {patient.nextAppointmentDate ? (
                        <span className="inline-flex items-center gap-1">
                          <CalendarClock className="h-3.5 w-3.5" />
                          {formatDistanceToNow(new Date(patient.nextAppointmentDate), {
                            addSuffix: true,
                          })}
                        </span>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1.5">
                        {patient.pending.map((t) => (
                          <div
                            key={t.templateId}
                            className="flex items-center justify-between gap-3"
                          >
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm">{t.templateName}</span>
                              {t.category && (
                                <Badge variant="secondary" className="capitalize text-[10px]">
                                  {t.category}
                                </Badge>
                              )}
                              {t.requiresWitness && (
                                <Badge variant="outline" className="text-[10px]">
                                  Witness required
                                </Badge>
                              )}
                            </div>
                            <Button
                              asChild
                              size="sm"
                              variant="outline"
                              className="gap-1.5 shrink-0"
                            >
                              <Link
                                to={`/consents/sign?patientId=${patient.patientId}&templateId=${t.templateId}`}
                              >
                                <PenLine className="h-3.5 w-3.5" />
                                Collect
                              </Link>
                            </Button>
                          </div>
                        ))}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
