import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { MedicalRecordDetailContent } from '@/components/medical-records/medical-record-detail-content'
import { getMedicalRecord } from '@/lib/actions/medical-records'

export default function MedicalRecordDetailPage() {
  const navigate = useNavigate()
  const params = useParams()
  const id = params.id as string
  const [loading, setLoading] = useState(true)
  const [record, setRecord] = useState<any>(null)

  useEffect(() => {
    async function fetchMedicalRecord() {
      try {
        const result = await getMedicalRecord(id)

        if (!result.success || !result.data) {
          navigate('/404')
          return
        }

        setRecord(result.data)
      } catch (error) {
        console.error('Failed to fetch medical record:', error)
        navigate('/404')
      } finally {
        setLoading(false)
      }
    }

    fetchMedicalRecord()
  }, [navigate, id])

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!record) {
    return null
  }

  return <MedicalRecordDetailContent record={record} />
}
