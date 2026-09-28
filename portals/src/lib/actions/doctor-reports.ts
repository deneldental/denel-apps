import { api } from '@/lib/api-client'

/** A week's compilation of one doctor's clinical activity. Read-only, no money. */
export interface DoctorWeeklySummary {
  weekStart: string
  weekEnd: string
  doctorId: string | null
  doctorName: string | null
  totals: {
    appointments: number
    completed: number
    noShow: number
    cancelled: number
    remaining: number
    uniquePatients: number
    estimatesRequested: number
    estimatesReady: number
    estimatesInvoiced: number
    clinicalNotes: number
    prescriptions: number
    treatmentPlans: number
    treatmentPlansAccepted: number
  }
  days: Array<{
    date: string
    appointments: number
    completed: number
    noShow: number
    cancelled: number
  }>
}

/** `weekStart` is any date inside the wanted week — the backend snaps to Monday. */
export const getDoctorWeeklySummary = (weekStart?: string, doctorId?: string) => {
  const q = new URLSearchParams()
  if (weekStart) q.set('weekStart', weekStart)
  if (doctorId) q.set('doctorId', doctorId)
  const qs = q.toString()
  return api.get<DoctorWeeklySummary>(`/api/worklist/doctor/weekly${qs ? `?${qs}` : ''}`)
}
