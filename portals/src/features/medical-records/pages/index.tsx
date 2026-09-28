import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { getMedicalRecords, getPendingMedicalRecords } from '@/lib/actions/medical-records'
import { api } from '@/lib/api-client'
import { useLoading } from '@/lib/loading-context'
import { useApiQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query-keys'
import { usePermissions } from '@/shared/hooks/use-permissions'
import { MedicalRecordsClient } from './medical-records-client'

export default function MedicalRecordsPage() {
  const { hasPermission, isLoading: permissionsLoading } = usePermissions()
  const isClinicalUser =
    hasPermission('medical_records', 'write') && !hasPermission('appointments', 'create')
  const { setIsLoading } = useLoading()

  const recordsQuery = useApiQuery(queryKeys.medicalRecords.list(), () => getMedicalRecords(), {
    enabled: !permissionsLoading,
  })
  const records = recordsQuery.data ?? []
  const error = recordsQuery.isError
    ? recordsQuery.error.message || 'You do not have permission to view medical records.'
    : null

  // getPendingMedicalRecords() returns a bare array (any failure already
  // swallowed to []), not the {success,data,error} envelope — so this stays a
  // raw useQuery rather than useApiQuery's unwrap.
  const pendingQuery = useQuery({
    queryKey: queryKeys.medicalRecords.pending(),
    queryFn: () => getPendingMedicalRecords(),
    enabled: !permissionsLoading,
  })
  const pendingRecords = pendingQuery.data ?? []

  // Same fix as the appointments page: /api/doctors is built from
  // `specialists`, so scanning it for `userId === me` never matched a
  // directly-linked doctors row. /api/doctors/me resolves both shapes.
  const doctorMeQuery = useApiQuery<{ id: string; name: string | null } | null>(
    queryKeys.doctors.me(),
    () => api.get<{ id: string; name: string | null } | null>('/api/doctors/me'),
    { enabled: !permissionsLoading && isClinicalUser }
  )
  const doctorId = doctorMeQuery.data?.id
  const doctorName = doctorMeQuery.data?.name || undefined

  const isLoading = recordsQuery.isFetching || pendingQuery.isFetching || doctorMeQuery.isFetching

  useEffect(() => {
    setIsLoading(isLoading)
  }, [isLoading, setIsLoading])

  const reload = () => {
    recordsQuery.refetch()
    pendingQuery.refetch()
    doctorMeQuery.refetch()
  }

  if (isLoading || permissionsLoading) return null

  if (error) {
    return (
      <div className="flex flex-col gap-6 p-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Medical Records</h1>
          <p className="text-muted-foreground mt-2 text-destructive">{error}</p>
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
      isDoctor={isClinicalUser}
      onReload={reload}
    />
  )
}
