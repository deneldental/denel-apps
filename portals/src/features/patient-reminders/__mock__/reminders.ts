// TODO(backend-wiring): replace with api.get('/api/patient-reminders/patient/:id')
// Scheduled SMS reminders for a patient. These will eventually be persisted in
// the backend and dispatched via cron -> Hubtel. For now the UI works against
// in-memory mock state so M2.8 can land as a pure UI pass.

export type ReminderStatus = 'pending' | 'sent' | 'failed' | 'cancelled'

export interface PatientReminder {
  id: string
  patientId: string
  subject: string
  /** ISO timestamp the reminder is scheduled to be sent. */
  scheduledAt: string
  /** Resolved SMS body (canonical template output or the user's custom text). */
  message: string
  status: ReminderStatus
  /** ISO timestamp when the SMS was actually dispatched. */
  sentAt: string | null
  /** Populated only when status === 'failed'. */
  failureReason: string | null
  /** ISO timestamp when the row was created. */
  createdAt: string
}

/**
 * Canonical SMS template surfaced in the live preview. When the user does
 * not override the message body, this template is what the backend will
 * render + send. `{firstName}`, `{subject}`, `{date}`, `{time}` are filled
 * in at send time.
 */
export const SMS_TEMPLATE =
  'Hi {firstName}, this is a reminder about {subject} on {date} at {time}. – Denel Dental'

const MOCK_PATIENT_ID = '85007caf-bf47-466f-8a7f-e8464b9377c3'

export const MOCK_PATIENT_REMINDERS: PatientReminder[] = [
  {
    id: 'rem_001',
    patientId: MOCK_PATIENT_ID,
    subject: 'follow-up cleaning',
    scheduledAt: '2026-04-15T10:00:00.000Z',
    message:
      'Hi Henry, this is a reminder about follow-up cleaning on 2026-04-15 at 10:00. – Denel Dental',
    status: 'pending',
    sentAt: null,
    failureReason: null,
    createdAt: '2026-04-10T09:12:00.000Z',
  },
  {
    id: 'rem_002',
    patientId: MOCK_PATIENT_ID,
    subject: 'ortho adjustment',
    scheduledAt: '2026-04-20T14:30:00.000Z',
    message:
      'Hi Henry, this is a reminder about ortho adjustment on 2026-04-20 at 14:30. – Denel Dental',
    status: 'pending',
    sentAt: null,
    failureReason: null,
    createdAt: '2026-04-11T11:00:00.000Z',
  },
  {
    id: 'rem_003',
    patientId: MOCK_PATIENT_ID,
    subject: 'consent form signing',
    scheduledAt: '2026-04-12T08:00:00.000Z',
    message: 'Hi Henry, please bring your signed consent form to your visit today. – Denel Dental',
    status: 'sent',
    sentAt: '2026-04-12T08:00:12.000Z',
    failureReason: null,
    createdAt: '2026-04-08T15:45:00.000Z',
  },
  {
    id: 'rem_004',
    patientId: MOCK_PATIENT_ID,
    subject: 'x-ray review',
    scheduledAt: '2026-04-05T09:15:00.000Z',
    message:
      'Hi Henry, this is a reminder about x-ray review on 2026-04-05 at 09:15. – Denel Dental',
    status: 'sent',
    sentAt: '2026-04-05T09:15:03.000Z',
    failureReason: null,
    createdAt: '2026-04-01T10:22:00.000Z',
  },
  {
    id: 'rem_005',
    patientId: MOCK_PATIENT_ID,
    subject: 'payment plan installment',
    scheduledAt: '2026-04-02T07:30:00.000Z',
    message:
      'Hi Henry, this is a reminder about payment plan installment on 2026-04-02 at 07:30. – Denel Dental',
    status: 'failed',
    sentAt: null,
    failureReason: 'Hubtel: invalid recipient (number unreachable)',
    createdAt: '2026-03-28T13:01:00.000Z',
  },
]
