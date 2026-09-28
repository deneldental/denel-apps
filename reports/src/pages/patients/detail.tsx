import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { PatientDetailContent } from '@/components/patients/patient-detail-content'
import { getMedicalRecordsByPatientId } from '@/lib/actions/medical-records'
import { getPatient } from '@/lib/actions/patients'
import { getPaymentPlanByPatientId } from '@/lib/actions/payment-plans'
import { getPaymentsByPatientId } from '@/lib/actions/payments'
import { getUserRole } from '@/lib/actions/users'
import { ROLES } from '@/lib/modules'
import { getCurrentUser, isDoctorOrAdmin } from '@/lib/rbac'

export default function PatientPage() {
  const navigate = useNavigate()
  const params = useParams()
  const id = params.id as string
  const [loading, setLoading] = useState(true)
  const [patient, setPatient] = useState<any>(null)
  const [medicalRecords, setMedicalRecords] = useState<any[]>([])
  const [payments, setPayments] = useState<any[]>([])
  const [paymentPlan, setPaymentPlan] = useState<any>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [canViewMedicalRecords, setCanViewMedicalRecords] = useState(false)
  const [canEdit, setCanEdit] = useState(true)

  useEffect(() => {
    async function fetchData() {
      try {
        const currentUser = await getCurrentUser()

        const [
          patientResult,
          medicalRecordsResult,
          paymentsResult,
          paymentPlanResult,
          userRoleResult,
        ] = await Promise.all([
          getPatient(id),
          getMedicalRecordsByPatientId(id),
          getPaymentsByPatientId(id),
          getPaymentPlanByPatientId(id),
          currentUser
            ? getUserRole(currentUser.id)
            : Promise.resolve({ success: false, error: 'Not authenticated' }),
        ])

        if (!patientResult.success || !patientResult.data) {
          navigate('/404')
          return
        }

        const patientData = patientResult.data
        setPatient(patientData)
        setMedicalRecords(medicalRecordsResult.success ? medicalRecordsResult.data || [] : [])
        setPayments(paymentsResult.success ? paymentsResult.data || [] : [])
        setPaymentPlan(paymentPlanResult.success ? paymentPlanResult.data : null)

        const userRole =
          userRoleResult.success && 'data' in userRoleResult ? userRoleResult.data : null
        setIsAdmin(userRole === ROLES.ADMIN)

        const doctorOrAdmin = currentUser ? await isDoctorOrAdmin(currentUser.id) : false
        setCanViewMedicalRecords(doctorOrAdmin)
        setCanEdit(userRole !== ROLES.DOCTOR) // Doctors cannot edit patient info
      } catch (error) {
        console.error('Failed to fetch patient data:', error)
        navigate('/404')
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [navigate, id])

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!patient) {
    return null
  }

  return (
    <PatientDetailContent
      patient={patient}
      medicalRecords={canViewMedicalRecords ? medicalRecords : []}
      payments={payments}
      paymentPlan={paymentPlan}
      isAdmin={isAdmin}
      canViewMedicalRecords={canViewMedicalRecords}
      canEdit={canEdit}
    />
  )
}
