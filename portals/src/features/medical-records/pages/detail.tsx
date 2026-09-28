import { useParams } from 'react-router-dom'
import { MedicalRecordDetailContent } from '@/features/medical-records/components/medical-record-detail-content'
import { getMedicalRecord } from '@/lib/actions/medical-records'
import { useApiQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query-keys'
import { usePermissions } from '@/shared/hooks/use-permissions'

export default function MedicalRecordDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { canAccess, isAdmin, isLoading: permissionsLoading } = usePermissions()
  const hasAccess = isAdmin || canAccess('medical_records')

  const recordQuery = useApiQuery(
    queryKeys.medicalRecords.detail(id ?? ''),
    () => getMedicalRecord(id as string),
    { enabled: !permissionsLoading && hasAccess && !!id }
  )
  const record = recordQuery.data ?? null
  const isLoading = recordQuery.isFetching

  const error = permissionsLoading
    ? null
    : !hasAccess
      ? 'You do not have permission to view medical records'
      : !id
        ? 'Medical record ID is missing'
        : recordQuery.isError
          ? recordQuery.error.message || 'Failed to fetch medical record'
          : null

  if (permissionsLoading || isLoading) {
    return null
  }

  if (error) return <div className="p-8 text-center text-red-500">Error: {error}</div>
  if (!record) return <div className="p-8 text-center text-muted-foreground">Record not found</div>

  return <MedicalRecordDetailContent record={record} onReload={() => recordQuery.refetch()} />
}
