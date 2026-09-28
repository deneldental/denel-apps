import { format, formatDistanceToNow } from 'date-fns'
import { Calendar, CheckCircle2, FileText, Stethoscope, Users } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

function getInitials(name: string) {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

type DoctorDashboardContentProps = {
  stats: {
    totalOrthoPatients: number
    signedConsentForms: number
    totalMedicalRecords: number
    todayCheckedIn: number
    todayBooked: number
  }
  upcomingAppointments: Array<{
    id: string
    date: Date
    status: string
    type: string
    patient: {
      id: string
      name: string
      phone: string | null
      profileImage: string | null
    }
    doctor: {
      id: string
      user: {
        name: string
      }
    }
  }>
  recentMedicalRecords: Array<{
    id: string
    date: Date | null
    complaint: string | null
    diagnosis: string | null
    createdAt: Date
    patient: {
      id: string
      name: string
      profileImage: string | null
    }
    doctor: {
      id: string
      user: {
        name: string
      }
    }
  }>
}

export function DoctorDashboardContent({
  stats,
  upcomingAppointments,
  recentMedicalRecords,
}: DoctorDashboardContentProps) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Doctor Dashboard</h1>
        <p className="text-muted-foreground">Overview of your patients and appointments</p>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {/* Card 1: Total Ortho Patients */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Ortho Patients</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalOrthoPatients}</div>
            <p className="text-xs text-muted-foreground">Total in system</p>
          </CardContent>
        </Card>

        {/* Card 2: Signed Consent Forms */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Signed Consents</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.signedConsentForms}</div>
            <p className="text-xs text-muted-foreground">Completed consent forms</p>
          </CardContent>
        </Card>

        {/* Card 3: Total Medical Records */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Medical Records</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalMedicalRecords}</div>
            <p className="text-xs text-muted-foreground">Total records submitted</p>
          </CardContent>
        </Card>

        {/* Card 4: Today's Appointments */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Today&apos;s Appointments</CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {stats.todayCheckedIn}/{stats.todayBooked}
            </div>
            <p className="text-xs text-muted-foreground">Checked-in / Booked</p>
          </CardContent>
        </Card>
      </div>

      {/* Content Grid */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Upcoming Appointments */}
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              Upcoming Appointments
            </CardTitle>
            <CardDescription>Your scheduled appointments</CardDescription>
          </CardHeader>
          <CardContent>
            {upcomingAppointments.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">No upcoming appointments</div>
            ) : (
              <div className="space-y-3">
                {upcomingAppointments.map((appointment) => (
                  <Link
                    key={appointment.id}
                    to={`/patients/${appointment.patient.id}`}
                    className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <Avatar className="h-10 w-10">
                        {appointment.patient.profileImage ? (
                          <AvatarImage src={appointment.patient.profileImage} />
                        ) : (
                          <AvatarFallback>{getInitials(appointment.patient.name)}</AvatarFallback>
                        )}
                      </Avatar>
                      <div>
                        <p className="font-medium">{appointment.patient.name}</p>
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
        <Card className="md:col-span-2">
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
                {recentMedicalRecords.map((record) => (
                  <Link
                    key={record.id}
                    to={`/medical-records/${record.id}`}
                    className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <Avatar className="h-10 w-10">
                        {record.patient.profileImage ? (
                          <AvatarImage src={record.patient.profileImage} />
                        ) : (
                          <AvatarFallback>{getInitials(record.patient.name)}</AvatarFallback>
                        )}
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium">{record.patient.name}</p>
                        <p className="text-sm text-muted-foreground truncate">
                          {record.diagnosis || record.complaint || 'No diagnosis'}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm text-muted-foreground">
                        {formatDistanceToNow(new Date(record.createdAt), { addSuffix: true })}
                      </p>
                      <p className="text-xs text-muted-foreground">Dr. {record.doctor.user.name}</p>
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
