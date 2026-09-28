import { api } from '@/lib/api-client'

export async function getAppointmentTypeReminders(appointmentTypeId: string) {
  return api.get<any[]>(`/api/appointment-type-reminders/${appointmentTypeId}`)
}

export async function updateAppointmentTypeReminders(
  appointmentTypeId: string,
  data: {
    reminders: {
      triggerType: 'on_booking' | 'before_appointment'
      offsetHours?: number | null
      templateId: string
      isActive: boolean
    }[]
  }
) {
  return api.put<any>(`/api/appointment-type-reminders/${appointmentTypeId}`, data)
}
