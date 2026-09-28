import { useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { PatientDetailContent } from '@/features/patients/components/patient-detail-content'
import { getPatient } from '@/lib/actions/patients'
import { useApiQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query-keys'
import { usePermissions } from '@/shared/hooks/use-permissions'

export default function PatientPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { hasPermission, isLoading: permissionsLoading, isAdmin } = usePermissions()
  const isClinicalUser =
    hasPermission('medical_records', 'read') && !hasPermission('appointments', 'create')
  const canEdit = hasPermission('patients', 'update')

  // Only the patient record is fetched here. The payments list and the
  // payment plan used to be fetched alongside it and handed to
  // `PatientDetailContent` as props it never read — two round trips whose
  // results were discarded. The financial figures the pane does render now
  // come from the single `/api/patients/:id/summary` aggregate it fetches
  // itself.
  const patientQuery = useApiQuery(
    queryKeys.patients.detail(id ?? ''),
    () => getPatient(id as string),
    { enabled: !!id && !permissionsLoading }
  )

  useEffect(() => {
    if (!id || patientQuery.isError) {
      navigate('/patients')
    }
  }, [id, patientQuery.isError, navigate])

  if (permissionsLoading || patientQuery.isLoading) return null
  if (!patientQuery.data) return null

  return (
    <PatientDetailContent
      patient={patientQuery.data}
      isAdmin={isAdmin}
      isDoctor={isClinicalUser}
      canViewMedicalRecords={isClinicalUser}
      canEdit={canEdit}
    />
  )
}
