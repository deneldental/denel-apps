import { useEffect, useState } from 'react'
import { apiClient } from '@/lib/api-client'
import { MedicalRecordsClient } from './medical-records-client'

export default function MedicalRecordsPage() {
  const [records, setRecords] = useState<any[]>([])
  const [pendingRecords, setPendingRecords] = useState<any[]>([])
  const doctorId: string | undefined = undefined
  const [doctorName, setDoctorName] = useState<string | undefined>()
  const [userRole, setUserRole] = useState<string | undefined>()
  const [isDoctor, setIsDoctor] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function loadData() {
      try {
        const userRes = await apiClient<any>('/api/auth/session')
        if (userRes.success && userRes.data?.user) {
          const role = userRes.data.user.role
          setUserRole(role)

          if (role === 'doctor' || role === 'doc') {
            setIsDoctor(true)
            setDoctorName(userRes.data.user.name)
            // We'd ideally fetch the doctor profile here if needed
          }
        }

        const [recordsRes, pendingRes] = await Promise.all([
          apiClient<any[]>('/api/medical-records'),
          apiClient<any[]>('/api/medical-records/pending'),
        ])

        if (!recordsRes.success) {
          setError(recordsRes.error || 'Failed to load records')
        } else {
          setRecords(recordsRes.data || [])
        }

        if (pendingRes.success) {
          setPendingRecords(pendingRes.data || [])
        }
      } catch (err) {
        console.error('Failed to load medical records:', err)
        setError('An unexpected error occurred.')
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [])

  if (loading) {
    return <div className="p-8 flex items-center justify-center">Loading medical records...</div>
  }

  if (error) {
    return (
      <div className="flex flex-col gap-6 p-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Medical Records</h1>
          <p className="text-muted-foreground mt-2 text-destructive">
            {error ||
              'You do not have permission to view medical records. Only doctors and admins can access this page.'}
          </p>
        </div>
      </div>
    )
  }

  return (
    <MedicalRecordsClient
      records={records}
      pendingRecords={pendingRecords}
      currentDoctorId={doctorId}
      currentDoctorName={doctorName}
      userRole={userRole}
      isDoctor={isDoctor}
    />
  )
}
