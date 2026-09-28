// Shared dashboard types. Backend response shapes that flow through the
// page-level loader and into the per-role content components.

export type DashboardPeriod = 'day' | 'week' | 'month'

export type AdminStats = {
  totalPatients: number
  totalRevenue: number
  totalExpenses: number
  checkedIn: number
  booked: number
}

export type ReceptionistStats = {
  totalPatients: number
  todayPayments: number
  todayExpenses: number
  todayCheckedIn: number
  todayBooked: number
}

export type DoctorStats = {
  newPatients: number
  signedConsentForms: number
  pendingMedicalRecords: number
  todayCheckedIn: number
  todayBooked: number
}

export type AppointmentRow = {
  id: string
  date: Date | string
  status: string
  type?: string
  confirmationResponse?: string | null
  patient: {
    id: string
    name: string
    phone: string | null
    profileImage?: string | null
  }
  doctor?: {
    id?: string
    user?: { name: string }
  }
  [key: string]: unknown
}

export type RecentReport = {
  id: string
  reportDate: Date | string
  totalPayments: number
  totalExpenses: number
  checkedInCount: number
  newPatientsCount: number
  submittedBy: { name: string | null; email: string | null } | null
}

export type LowStockItem = {
  id: string
  name: string
  stockQuantity: number
  reorderLevel: number | null
  unit: string | null
  type: 'inventory' | 'product' | string
}

export type BirthdayItem = {
  id: string
  name: string
  phone: string | null
  profileImage: string | null
  dob: Date | string
  type: 'birthday'
  date: Date | string
  isToday: boolean
  isTomorrow: boolean
}

export type FollowupItem = {
  id: string
  name: string
  phone: string | null
  profileImage: string | null
  type: 'followup'
  date: Date | string
  appointmentId: string
}

export type AlertsPayload = { birthdays: BirthdayItem[]; followups: FollowupItem[] }

export type RecentMedicalRecord = {
  id: string
  date: Date | string | null
  complaint: string | null
  diagnosis: string | null
  createdAt: Date | string
  patient: { id: string; name: string; profileImage: string | null }
  doctor: { id: string; user: { name: string } }
}

export type OverduePaymentPlan = {
  id: string
  patient: {
    id: string
    name: string
    phone: string | null
    guardianPhone: string | null
    isChild: boolean
  }
  totalAmount: number
  amountPerInstallment: number | null
  paymentFrequency: string | null
  startDate: Date | string
  payments: Array<{ amount: number; status: string }>
  /** Server-authoritative overdue amount. Older API responses may omit. */
  overdueAmount?: number
}

// ── Action items (recare due / reminders / unconfirmed appts) ────────────────

export type RecareDueItem = {
  id: string
  patientId: string
  recallReason: string | null
  recallDueDate: string
  status: string
  contactedAt: string | null
  patient?: { id: string; name: string; phone: string | null; patientId: string | null }
}

export type Reminder = {
  id: string
  patientId: string | null
  title: string
  reminderDate: string
  status: string
  assignedToId: string | null
  /** 'patient' (default) | 'specialist' — Phase 4 polymorphic target. */
  targetType?: 'patient' | 'specialist'
  targetSpecialistId?: string | null
  patient?: { id: string; name: string; phone: string | null; patientId: string | null } | null
  targetSpecialist?: { id: string; name: string; contactPhone: string | null } | null
}

export type ActionItemsData = {
  recalls: RecareDueItem[]
  reminders: Reminder[]
  unconfirmedAppts: AppointmentRow[]
}
