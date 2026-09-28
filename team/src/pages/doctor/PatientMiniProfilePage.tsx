import { format, formatDistanceToNow } from 'date-fns'
import { ArrowLeft, FileText, Image as ImageIcon, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'

import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { api } from '@/lib/api'
import { QuickNoteSheet } from '@/shared/components/quick-note-sheet'

interface Patient {
  id: string
  patientId: string
  name: string
  phone: string | null
  dateOfBirth: string | null
  gender: string | null
  createdAt: string
}

interface Appointment {
  id: string
  date: string
  durationMinutes: number
  status: string
  type: string
  notes: string | null
  doctor?: { user?: { name: string } }
}

interface Xray {
  id: string
  thumbnailUrl: string | null
  imageUrl: string
  takenAt: string
  type?: { displayName?: string }
}

const STATUS_LABEL: Record<string, string> = {
  scheduled: 'Scheduled',
  confirmed: 'Confirmed',
  checked_in: 'Checked in',
  in_progress: 'In progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
  no_show: 'No show',
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((p) => p[0] ?? '')
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

function calcAge(dob: string | null): number | null {
  if (!dob) return null
  const diff = Date.now() - new Date(dob).getTime()
  return Math.floor(diff / (1000 * 60 * 60 * 24 * 365.25))
}

function XrayThumb({ xray }: { xray: Xray }) {
  const [errored, setErrored] = useState(false)
  const typeName = xray.type?.displayName ?? 'X-ray'
  return (
    <Card className="overflow-hidden">
      <div className="aspect-square bg-muted relative">
        {errored ? (
          <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
            <ImageIcon className="h-6 w-6" />
          </div>
        ) : (
          <img
            src={xray.thumbnailUrl ?? xray.imageUrl}
            alt={typeName}
            loading="lazy"
            decoding="async"
            className="absolute inset-0 w-full h-full object-cover"
            onError={() => setErrored(true)}
          />
        )}
      </div>
      <CardContent className="p-2 space-y-1">
        <p className="text-[10px] text-muted-foreground font-mono">
          {format(new Date(xray.takenAt), 'MMM d, yyyy')}
        </p>
        <span className="inline-block px-2 py-0.5 rounded-full bg-muted text-[10px] capitalize">
          {typeName}
        </span>
      </CardContent>
    </Card>
  )
}

export default function DoctorPatientMiniProfilePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [patient, setPatient] = useState<Patient | null>(null)
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [xrays, setXrays] = useState<Xray[]>([])
  const [loading, setLoading] = useState(true)
  const [quickNoteOpen, setQuickNoteOpen] = useState(false)

  useEffect(() => {
    if (!id) return
    Promise.all([
      api.get<Patient>(`/api/patients/${id}`),
      api.get<Appointment[]>(`/api/appointments?patientId=${id}`),
      api.get<Xray[]>(`/api/xrays/patient/${id}`),
    ])
      .then(([patRes, apptRes, xrayRes]) => {
        if (patRes.success && patRes.data) setPatient(patRes.data as Patient)
        if (apptRes.success && Array.isArray(apptRes.data)) setAppointments(apptRes.data)
        if (xrayRes.success && Array.isArray(xrayRes.data)) setXrays(xrayRes.data)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [id])

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!patient) {
    return (
      <div className="p-6">
        <Button variant="ghost" size="sm" onClick={() => navigate('/doctor/patients')}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Back
        </Button>
        <Card className="mt-4">
          <CardContent className="py-10 text-center">
            <p className="text-sm text-muted-foreground">Patient not found.</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  const pastRecords = appointments
    .filter((a) => new Date(a.date).getTime() + a.durationMinutes * 60000 < Date.now())
    .sort((a, b) => b.date.localeCompare(a.date))

  const age = calcAge(patient.dateOfBirth)

  return (
    <div className="pb-32 relative">
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => navigate('/doctor/patients')}
            aria-label="Back"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm truncate">{patient.name}</p>
            <p className="font-mono text-xs text-muted-foreground">#{patient.patientId}</p>
          </div>
        </div>
      </div>

      <div className="p-5 space-y-5">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <Avatar className="h-14 w-14">
              <AvatarFallback className="bg-primary/10 text-primary text-lg font-bold">
                {getInitials(patient.name)}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <h1 className="text-lg font-bold leading-tight">{patient.name}</h1>
              <span className="inline-block px-2 py-0.5 rounded-full bg-muted text-[10px] font-mono mt-1">
                #{patient.patientId}
              </span>
              <div className="flex flex-wrap gap-1.5 mt-2 text-[11px]">
                {age != null && (
                  <span className="px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                    {age} yrs
                  </span>
                )}
                {patient.gender && (
                  <span className="px-2 py-0.5 rounded-full bg-muted text-muted-foreground capitalize">
                    {patient.gender}
                  </span>
                )}
                {patient.phone && (
                  <span className="px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                    {patient.phone}
                  </span>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <Tabs defaultValue="records" className="w-full">
          <TabsList className="grid grid-cols-4 w-full">
            <TabsTrigger value="records">Records</TabsTrigger>
            <TabsTrigger value="xrays">X-rays</TabsTrigger>
            <TabsTrigger value="plan">Plan</TabsTrigger>
            <TabsTrigger value="timeline">Timeline</TabsTrigger>
          </TabsList>

          <TabsContent value="records" className="space-y-2">
            {pastRecords.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center text-sm text-muted-foreground">
                  No past records.
                </CardContent>
              </Card>
            ) : (
              pastRecords.map((r) => (
                <Card key={r.id}>
                  <CardContent className="p-3 flex items-center gap-3">
                    <div className="text-xs font-mono text-muted-foreground w-20 shrink-0">
                      {format(new Date(r.date), 'MMM d')}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate capitalize">{r.type}</p>
                      {r.notes && (
                        <p className="text-xs text-muted-foreground truncate">{r.notes}</p>
                      )}
                    </div>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground whitespace-nowrap">
                      {STATUS_LABEL[r.status] ?? r.status}
                    </span>
                  </CardContent>
                </Card>
              ))
            )}
          </TabsContent>

          <TabsContent value="xrays">
            {xrays.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center text-sm text-muted-foreground">
                  No X-rays on file.
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {xrays.map((x) => (
                  <XrayThumb key={x.id} xray={x} />
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="plan">
            <Card>
              <CardContent className="p-4 space-y-2">
                <p className="text-sm text-muted-foreground">
                  Treatment plan — open in desktop portal.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => toast.info('Opens in desktop portal')}
                >
                  Open in desktop portal →
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="timeline" className="space-y-2">
            {appointments.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center text-sm text-muted-foreground">
                  No timeline events.
                </CardContent>
              </Card>
            ) : (
              appointments
                .sort((a, b) => b.date.localeCompare(a.date))
                .map((a) => (
                  <Card key={a.id}>
                    <CardContent className="p-3 flex items-center justify-between gap-3">
                      <p className="text-sm capitalize">
                        {a.type} · {STATUS_LABEL[a.status] ?? a.status}
                      </p>
                      <p className="text-[11px] text-muted-foreground whitespace-nowrap">
                        {formatDistanceToNow(new Date(a.date), { addSuffix: true })}
                      </p>
                    </CardContent>
                  </Card>
                ))
            )}
          </TabsContent>
        </Tabs>
      </div>

      <div className="fixed bottom-16 inset-x-0 z-20 border-t border-border bg-background/95 backdrop-blur px-4 py-3">
        <Button
          variant="outline"
          className="w-full"
          onClick={() => toast.info('Opens in desktop portal')}
        >
          Open full profile in desktop →
        </Button>
      </div>

      <button
        type="button"
        onClick={() => setQuickNoteOpen(true)}
        aria-label="Quick note"
        className="fixed bottom-32 right-5 z-30 h-12 w-12 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center hover:opacity-90 transition-opacity"
      >
        <FileText className="h-5 w-5" />
      </button>

      <QuickNoteSheet
        open={quickNoteOpen}
        onOpenChange={setQuickNoteOpen}
        defaultPatient={{ id: patient.id, name: patient.name }}
      />
    </div>
  )
}
