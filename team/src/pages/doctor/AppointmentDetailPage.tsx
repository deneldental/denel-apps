import { format } from 'date-fns'
import { ArrowLeft, FileText, Image as ImageIcon, Loader2, PlayCircle, Send } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { api } from '@/lib/api'
import { QuickNoteSheet } from '@/shared/components/quick-note-sheet'

type AppointmentStatus =
  | 'scheduled'
  | 'confirmed'
  | 'checked_in'
  | 'in_progress'
  | 'completed'
  | 'cancelled'
  | 'no_show'

interface Appointment {
  id: string
  date: string
  status: AppointmentStatus
  type: string
  durationMinutes: number
  notes: string | null
  chiefComplaint: string | null
  patientId: string
  doctorId: string
  patient: { id: string; name: string; phone: string | null } | null
  doctor: { id: string; user: { name: string } } | null
}

const STATUS_PILL: Record<AppointmentStatus, string> = {
  scheduled: 'bg-gray-100 text-gray-700',
  confirmed: 'bg-blue-100 text-blue-700',
  checked_in: 'bg-indigo-100 text-indigo-700',
  in_progress: 'bg-amber-100 text-amber-700',
  completed: 'bg-emerald-100 text-emerald-700',
  cancelled: 'bg-muted text-muted-foreground',
  no_show: 'bg-red-100 text-red-700',
}

const STATUS_LABEL: Record<AppointmentStatus, string> = {
  scheduled: 'Scheduled',
  confirmed: 'Confirmed',
  checked_in: 'Checked in',
  in_progress: 'In progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
  no_show: 'No show',
}

/** Which terminal statuses show no action buttons. */
const TERMINAL_STATUSES: AppointmentStatus[] = ['completed', 'cancelled', 'no_show']

interface TimelineEntry {
  id: string
  eventType: string
  title: string
  description: string | null
  createdAt: string
  createdBy: { id: string; name: string } | null
}

export default function DoctorAppointmentDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [appt, setAppt] = useState<Appointment | null>(null)
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState('')
  const [notes, setNotes] = useState<TimelineEntry[]>([])
  const [postingNote, setPostingNote] = useState(false)
  const [quickNoteOpen, setQuickNoteOpen] = useState(false)

  useEffect(() => {
    if (!id) return
    let cancelled = false
    async function load() {
      const apptRes = await api.get<Appointment>(`/api/appointments/${id}`)
      if (cancelled) return
      let loaded: Appointment | null = null
      if (apptRes.success && apptRes.data) {
        loaded = apptRes.data
        setAppt(loaded)
      } else {
        toast.error(apptRes.error || 'Failed to load appointment')
      }
      if (loaded?.patientId) {
        const notesRes = await api.get<TimelineEntry[]>(`/api/patient-timeline/${loaded.patientId}`)
        if (!cancelled && notesRes.success && Array.isArray(notesRes.data)) {
          setNotes(notesRes.data)
        }
      }
      if (!cancelled) setLoading(false)
    }
    load()
    return () => {
      cancelled = true
    }
  }, [id])

  const handleStatusChange = async (newStatus: AppointmentStatus) => {
    if (!id) return
    const res = await api.patch<any>(`/api/appointments/${id}`, {
      data: { status: newStatus },
      sendSMS: false,
    })
    if (res.success) {
      setAppt((prev) => (prev ? { ...prev, status: newStatus } : prev))
      toast.success('Status updated')
    } else {
      toast.error(res.error || 'Failed to update status')
    }
  }

  const handlePostNote = async () => {
    if (!draft.trim() || !appt?.patientId) return
    setPostingNote(true)
    const res = await api.post<TimelineEntry>(`/api/patient-timeline/${appt.patientId}`, {
      eventType: 'note',
      title: draft.trim(),
    })
    setPostingNote(false)
    if (res.success && res.data) {
      setNotes((prev) => [res.data as TimelineEntry, ...prev])
      setDraft('')
      toast.success('Note added')
    } else {
      toast.error(res.error || 'Failed to post note')
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!appt) {
    return (
      <div className="p-6">
        <Button variant="ghost" size="sm" onClick={() => navigate('/doctor/today')}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Back
        </Button>
        <Card className="mt-4">
          <CardContent className="py-10 text-center">
            <p className="text-sm text-muted-foreground">Appointment not found.</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  const patientName = appt.patient?.name ?? 'Unknown patient'
  const doctorName = appt.doctor?.user?.name ?? 'Unknown doctor'
  const currentStatus = appt.status
  const isTerminal = TERMINAL_STATUSES.includes(currentStatus)

  return (
    <div className="pb-32">
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => navigate('/doctor/today')}
            aria-label="Back"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm truncate">{patientName}</p>
            <p className="text-xs text-muted-foreground">
              {format(new Date(appt.date), 'HH:mm')} · {appt.durationMinutes}m · {appt.type}
            </p>
          </div>
          <span
            className={`text-[10px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${STATUS_PILL[currentStatus]}`}
          >
            {STATUS_LABEL[currentStatus]}
          </span>
        </div>
      </div>

      <div className="p-5 space-y-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{patientName}</h1>
          <p className="text-sm text-muted-foreground">
            {format(new Date(appt.date), 'EEEE, MMM d · HH:mm')}
            {' · '}
            {appt.durationMinutes}m
          </p>
        </div>

        <Tabs defaultValue="snapshot" className="w-full">
          <TabsList className="grid grid-cols-3 w-full">
            <TabsTrigger value="snapshot">Snapshot</TabsTrigger>
            <TabsTrigger value="plan">Plan</TabsTrigger>
            <TabsTrigger value="notes">Notes</TabsTrigger>
          </TabsList>

          <TabsContent value="snapshot" className="space-y-3">
            <Card>
              <CardContent className="p-4 space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Patient
                </p>
                <p className="text-sm font-semibold">{patientName}</p>
                {appt.patient?.phone && (
                  <p className="text-xs text-muted-foreground">{appt.patient.phone}</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4 space-y-1">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Doctor
                </p>
                <p className="text-sm">{doctorName}</p>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4 space-y-1">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Chief complaint
                </p>
                <p className="text-sm">{appt.chiefComplaint ?? '—'}</p>
              </CardContent>
            </Card>

            {appt.notes && (
              <Card>
                <CardContent className="p-4 space-y-1">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Notes
                  </p>
                  <p className="text-sm">{appt.notes}</p>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="plan" className="space-y-3">
            <Card>
              <CardContent className="p-4 space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Active treatment plan
                </p>
                <p className="text-sm text-muted-foreground">
                  Treatment plan detail is managed in the desktop portal.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => toast.info('Open in desktop portal')}
                >
                  Edit in desktop portal →
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="notes" className="space-y-3">
            <div className="space-y-2">
              {notes.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">No notes yet.</p>
              )}
              {notes.map((n) => (
                <Card key={n.id}>
                  <CardContent className="p-3 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold">{n.createdBy?.name ?? 'Doctor'}</p>
                      <p className="text-[10px] text-muted-foreground font-mono">
                        {format(new Date(n.createdAt), 'MMM d HH:mm')}
                      </p>
                    </div>
                    <p className="text-sm">{n.title}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
            <Card>
              <CardContent className="p-3 space-y-2">
                <Textarea
                  rows={3}
                  placeholder="Add a note for this appointment..."
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                />
                <Button
                  size="sm"
                  className="w-full"
                  disabled={!draft.trim() || postingNote}
                  onClick={handlePostNote}
                >
                  {postingNote && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                  <Send className="h-4 w-4 mr-1" /> Post
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Bottom action bar */}
      {!isTerminal && (
        <div className="fixed bottom-16 inset-x-0 z-20 border-t border-border bg-background/95 backdrop-blur px-3 py-2">
          <div className="flex flex-wrap gap-1.5 justify-center">
            {currentStatus === 'scheduled' && (
              <Button
                size="sm"
                onClick={() => handleStatusChange('confirmed')}
                className="h-auto py-2 flex-col gap-0.5 text-[10px] flex-1 min-w-[70px]"
              >
                <PlayCircle className="h-4 w-4" />
                Confirm
              </Button>
            )}
            {currentStatus === 'confirmed' && (
              <Button
                size="sm"
                onClick={() => handleStatusChange('checked_in')}
                className="h-auto py-2 flex-col gap-0.5 text-[10px] flex-1 min-w-[70px]"
              >
                <PlayCircle className="h-4 w-4" />
                Check In
              </Button>
            )}
            {currentStatus === 'checked_in' && (
              <Button
                size="sm"
                onClick={() => handleStatusChange('in_progress')}
                className="h-auto py-2 flex-col gap-0.5 text-[10px] flex-1 min-w-[70px]"
              >
                <PlayCircle className="h-4 w-4" />
                Start
              </Button>
            )}
            {currentStatus === 'in_progress' && (
              <Button
                size="sm"
                onClick={() => handleStatusChange('completed')}
                className="h-auto py-2 flex-col gap-0.5 text-[10px] flex-1 min-w-[70px]"
              >
                <PlayCircle className="h-4 w-4" />
                Complete
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={() => setQuickNoteOpen(true)}
              className="h-auto py-2 flex-col gap-0.5 text-[10px] flex-1 min-w-[70px]"
            >
              <FileText className="h-4 w-4" />
              Quick note
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => toast.info('Requested — coming Wave 3')}
              className="h-auto py-2 flex-col gap-0.5 text-[10px] flex-1 min-w-[70px]"
            >
              <ImageIcon className="h-4 w-4" />
              Request X-ray
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => handleStatusChange('no_show')}
              className="h-auto py-2 flex-col gap-0.5 text-[10px] flex-1 min-w-[70px]"
            >
              No-show
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleStatusChange('cancelled')}
              className="h-auto py-2 flex-col gap-0.5 text-[10px] flex-1 min-w-[70px] text-destructive border-destructive/40"
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {isTerminal && (
        <div className="fixed bottom-16 inset-x-0 z-20 border-t border-border bg-background/95 backdrop-blur px-3 py-2 text-center">
          <p className="text-xs text-muted-foreground">
            This appointment is{' '}
            <span className="font-semibold">{STATUS_LABEL[currentStatus].toLowerCase()}</span> — no
            further actions.
          </p>
        </div>
      )}

      <QuickNoteSheet
        open={quickNoteOpen}
        onOpenChange={setQuickNoteOpen}
        defaultPatient={appt.patient ? { id: appt.patient.id, name: appt.patient.name } : undefined}
      />
    </div>
  )
}
