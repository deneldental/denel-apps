import { format, formatDistanceToNow } from 'date-fns'
import { Calendar, CheckCircle2, FileText, Stethoscope, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { AppointmentRow, DoctorStats, RecentMedicalRecord } from '@/features/dashboard/types'
import { authClient } from '@/lib/auth-client'
import { Avatar, AvatarFallback, AvatarImage } from '@/shared/components/ui/avatar'
import { Badge } from '@/shared/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card'
import { formatCompactNumber } from '@/shared/utils/currency'

function getInitials(name: string) {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

type DoctorDashboardContentProps = {
  stats: DoctorStats
  upcomingAppointments: AppointmentRow[]
  recentMedicalRecords: RecentMedicalRecord[]
}

export function DoctorDashboardContent({
  stats,
  upcomingAppointments,
  recentMedicalRecords,
}: DoctorDashboardContentProps) {
  const [firstName, setFirstName] = useState('')

  useEffect(() => {
    let cancelled = false
    authClient.getSession().then(({ data }) => {
      if (cancelled) return
      const u = data?.user as { name?: string } | undefined
      setFirstName(u?.name?.split(' ')[0] ?? '')
    })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* First row: Welcome card = full width */}
      <div className="rounded-2xl border bg-gradient-to-br from-blue-50 to-white dark:from-blue-950/40 dark:to-background p-5 flex flex-col justify-between gap-4 w-full">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Welcome back{firstName ? `, ${firstName}` : ''} <span aria-hidden>👋</span>
          </h1>
          <p className="text-sm text-muted-foreground">
            Overview of your patients and appointments.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex h-9 items-center rounded-md border bg-background px-3 text-sm font-medium text-muted-foreground">
            Today
          </span>
        </div>
      </div>

      {/* Second row: Stats cards - 4 columns */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* New patients/day — blue */}
        <div className="rounded-xl bg-gradient-to-br from-blue-100/70 to-blue-50/40 dark:from-blue-900/30 dark:to-blue-800/10 p-5 flex items-start justify-between border border-blue-200/60 dark:border-blue-800/40">
          <div className="space-y-2">
            <p className="text-sm font-medium text-blue-700 dark:text-blue-400">New patients/day</p>
            <p className="text-3xl font-bold text-blue-900 dark:text-blue-100">
              {formatCompactNumber(stats.newPatients)}
            </p>
            <p className="text-xs font-medium text-blue-800 dark:text-blue-300">Registered today</p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-700 text-white shadow-sm">
              <Users className="h-5 w-5" />
            </div>
          </div>
        </div>

        {/* Pending Medical Records — green */}
        <div className="rounded-xl bg-gradient-to-br from-green-100/70 to-green-50/40 dark:from-green-900/30 dark:to-green-800/10 p-5 flex items-start justify-between border border-green-200/60 dark:border-green-800/40">
          <div className="space-y-2">
            <p className="text-sm font-medium text-green-700 dark:text-green-400">
              Pending Medical Records
            </p>
            <p className="text-3xl font-bold text-green-900 dark:text-green-100">
              {formatCompactNumber(stats.pendingMedicalRecords)}
            </p>
            <p className="text-xs font-medium text-green-800 dark:text-green-300">Pending today</p>
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-700 text-white shadow-sm shrink-0">
            <FileText className="h-5 w-5" />
          </div>
        </div>

        {/* Booked Appointments — orange */}
        <div className="rounded-xl bg-gradient-to-br from-orange-100/70 to-orange-50/40 dark:from-orange-900/30 dark:to-orange-800/10 p-5 flex items-start justify-between border border-orange-200/60 dark:border-orange-800/40">
          <div className="space-y-2">
            <p className="text-sm font-medium text-orange-700 dark:text-orange-400">
              Booked Appointments
            </p>
            <p className="text-3xl font-bold text-orange-900 dark:text-orange-100">
              {stats.todayBooked}
            </p>
            <p className="text-xs font-medium text-orange-800 dark:text-orange-300">
              Total booked today
            </p>
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-orange-700 text-white shadow-sm shrink-0">
            <Calendar className="h-5 w-5" />
          </div>
        </div>

        {/* Checkedin Appointments — purple */}
        <div className="rounded-xl bg-gradient-to-br from-purple-100/70 to-purple-50/40 dark:from-purple-900/30 dark:to-purple-800/10 p-5 flex items-start justify-between border border-purple-200/60 dark:border-purple-800/40">
          <div className="space-y-2">
            <p className="text-sm font-medium text-purple-700 dark:text-purple-400">
              Checkedin Appointments
            </p>
            <p className="text-3xl font-bold text-purple-900 dark:text-purple-100">
              {stats.todayCheckedIn}
            </p>
            <p className="text-xs font-medium text-purple-800 dark:text-purple-300">
              Checked-in today
            </p>
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-700 text-white shadow-sm shrink-0">
            <CheckCircle2 className="h-5 w-5" />
          </div>
        </div>
      </div>

      {/* Third row: Content Grid (6/12 columns) */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Pending Appointments = max of 5 */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              Pending Appointments
            </CardTitle>
            <CardDescription>Your scheduled appointments</CardDescription>
          </CardHeader>
          <CardContent>
            {upcomingAppointments.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">No upcoming appointments</div>
            ) : (
              <div className="space-y-3">
                {upcomingAppointments.slice(0, 5).map((appointment) => (
                  <Link
                    key={appointment.id}
                    to={`/patients/${appointment.patient.id}`}
                    className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <Avatar className="h-10 w-10">
                        {appointment.patient?.profileImage ? (
                          <AvatarImage src={appointment.patient.profileImage} />
                        ) : (
                          <AvatarFallback>
                            {getInitials(appointment.patient?.name ?? '?')}
                          </AvatarFallback>
                        )}
                      </Avatar>
                      <div>
                        <p className="font-medium">
                          {appointment.patient?.name ?? 'Unknown patient'}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {format(new Date(appointment.date), "MMM d, yyyy 'at' h:mm a")}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={appointment.status === 'completed' ? 'default' : 'secondary'}>
                        {appointment.status}
                      </Badge>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Medical Records */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Stethoscope className="h-5 w-5" />
              Recent Medical Records
            </CardTitle>
            <CardDescription>Recently submitted medical records</CardDescription>
          </CardHeader>
          <CardContent>
            {recentMedicalRecords.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">No medical records yet</div>
            ) : (
              <div className="space-y-3">
                {recentMedicalRecords.slice(0, 5).map((record) => (
                  <Link
                    key={record.id}
                    to={`/medical-records/${record.id}`}
                    className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <Avatar className="h-10 w-10">
                        {record.patient?.profileImage ? (
                          <AvatarImage src={record.patient.profileImage} />
                        ) : (
                          <AvatarFallback>
                            {getInitials(record.patient?.name ?? '?')}
                          </AvatarFallback>
                        )}
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium">{record.patient?.name ?? 'Unknown patient'}</p>
                        <p className="text-sm text-muted-foreground truncate">
                          {record.diagnosis || record.complaint || 'No diagnosis'}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm text-muted-foreground">
                        {formatDistanceToNow(new Date(record.createdAt), { addSuffix: true })}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Dr. {record.doctor?.user?.name ?? 'Unknown'}
                      </p>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
