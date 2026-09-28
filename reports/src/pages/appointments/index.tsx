import { useEffect, useState } from 'react'
import { AppointmentsShell } from '@/components/appointments/appointments-shell'
import { apiClient } from '@/lib/api-client'

export default function AppointmentsPage() {
  const [appointmentsData, setAppointmentsData] = useState<any[]>([])
  const unavailabilityData: any[] = []
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function loadData() {
      try {
        const appRes = await apiClient<any[]>('/api/appointments')

        if (appRes.success && appRes.data) setAppointmentsData(appRes.data)
        // Ignoring unavailability for now unless we know the endpoint
      } catch (error) {
        console.error('Failed to load appointments data:', error)
      } finally {
        setLoading(false)
      }
    }

    loadData()
  }, [])

  if (loading) {
    return (
      <div className="p-8 font-medium animate-pulse text-muted-foreground transition-all">
        Loading appointments...
      </div>
    )
  }

  return (
    <div className="flex-1 space-y-4 p-4 pt-6 md:p-8">
      <AppointmentsShell appointments={appointmentsData} unavailability={unavailabilityData} />
    </div>
  )
}
