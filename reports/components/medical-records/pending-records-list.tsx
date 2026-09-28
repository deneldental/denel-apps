import { format } from 'date-fns'
import { Calendar, Clock, FileText, User } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

interface PendingRecord {
  id: string
  patientId: string
  doctorId: string
  appointmentId?: string | null
  checkedInAt: Date | string
  status: string
  patient?: {
    id: string
    name: string
    patientId?: string
    phone?: string
    profileImage?: string
  }
  appointment?: {
    id: string
    date: Date | string
  }
}

interface PendingRecordsListProps {
  pendingRecords: PendingRecord[]
  currentDoctorId?: string
  currentDoctorName?: string
}

export function PendingRecordsList({ pendingRecords, currentDoctorName }: PendingRecordsListProps) {
  if (pendingRecords.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16">
          <FileText className="h-16 w-16 text-muted-foreground mb-4" />
          <h3 className="text-lg font-semibold mb-2">No Pending Records</h3>
          <p className="text-sm text-muted-foreground text-center max-w-md">
            When patients check in for their appointments, they will appear here for you to add
            their medical records.
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {pendingRecords.map((record) => (
        <Card key={record.id} className="hover:shadow-md transition-shadow">
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <Avatar>
                  <AvatarImage src={record.patient?.profileImage} />
                  <AvatarFallback>
                    {record.patient?.name
                      ?.split(' ')
                      .map((n: string) => n[0])
                      .join('')
                      .toUpperCase()
                      .slice(0, 2) || 'PT'}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <CardTitle className="text-lg">{record.patient?.name}</CardTitle>
                  {record.patient?.patientId && (
                    <CardDescription className="text-xs">
                      {record.patient.patientId}
                    </CardDescription>
                  )}
                </div>
              </div>
              <Badge variant="secondary">Pending</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Clock className="h-4 w-4" />
                <span>
                  Checked in: {format(new Date(record.checkedInAt), 'MMM dd, yyyy • h:mm a')}
                </span>
              </div>
              {record.appointment && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Calendar className="h-4 w-4" />
                  <span>
                    Appointment: {format(new Date(record.appointment.date), 'MMM dd, yyyy')}
                  </span>
                </div>
              )}
              {record.patient?.phone && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <User className="h-4 w-4" />
                  <span>{record.patient.phone}</span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
