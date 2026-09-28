import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { MedicalRecordsSubTabs } from '@/features/patient-cases/components/medical-records-sub-tabs'
import { api } from '@/lib/api-client'
import { useLoading } from '@/lib/loading-context'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/shared/components/ui/breadcrumb'

export default function PatientMedicalRecordsPage() {
  const { patientId } = useParams<{ patientId: string }>()
  const { setIsLoading } = useLoading()
  const [patientName, setPatientName] = useState<string | null>(null)

  useEffect(() => {
    if (!patientId) return
    setIsLoading(true)
    api.get<{ name: string }>(`/api/patients/${patientId}`).then((res) => {
      if (res.success && res.data) setPatientName((res.data as { name: string }).name ?? null)
      setIsLoading(false)
    })
  }, [patientId, setIsLoading])

  if (!patientId) return null

  return (
    <div className="flex flex-col gap-6 p-6">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link to="/medical-records">Medical Records</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{patientName ?? '—'}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div>
        <h1 className="text-2xl font-bold tracking-tight">{patientName ?? '—'}</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Medical records</p>
      </div>

      <MedicalRecordsSubTabs patientId={patientId} canEdit />
    </div>
  )
}
