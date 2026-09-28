import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { DashboardContent } from '@/components/dashboard/dashboard-content'
import { DoctorDashboardContent } from '@/components/dashboard/doctor-dashboard-content'
import { ReceptionistDashboardContent } from '@/components/dashboard/receptionist-dashboard-content'
import {
  getBirthdaysAndFollowups,
  getDashboardStats,
  getDoctorDashboardStats,
  getLowStockItems,
  getRecentMedicalRecords,
  getRecentReports,
  getReceptionistDashboardStats,
  getUpcomingAppointments,
} from '@/lib/actions/dashboard'
import { getOverduePaymentPlans } from '@/lib/actions/payment-plans'
import { api } from '@/lib/api-client'
import { ROLES } from '@/lib/modules'
import { getCurrentUser } from '@/lib/rbac'

export default function DashboardPage() {
  const [searchParams] = useSearchParams()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [isReceptionist, setIsReceptionist] = useState(false)
  const [isDoctor, setIsDoctor] = useState(false)
  const [period, setPeriod] = useState<'month' | 'week' | 'day'>('month')

  const [doctorData, setDoctorData] = useState<any>(null)
  const [adminData, setAdminData] = useState<any>(null)
  const [receptionistData, setReceptionistData] = useState<any>(null)

  useEffect(() => {
    async function loadData() {
      try {
        setLoading(true)
        const currentUser = await getCurrentUser()
        if (!currentUser) {
          setError('Not authenticated')
          return
        }

        const dbUserRes = await api.get<any>(`/api/users/${currentUser.id}`)
        const role =
          dbUserRes?.success && dbUserRes.data?.role?.id
            ? dbUserRes.data.role.id
            : (currentUser as any).roleId

        const _isReceptionist = role === ROLES.RECEPTIONIST
        const _isDoctor = role === ROLES.DOCTOR
        setIsReceptionist(_isReceptionist)
        setIsDoctor(_isDoctor)

        const paramsPeriod = searchParams.get('period')
        const _period: 'month' | 'week' | 'day' =
          paramsPeriod === 'day' || paramsPeriod === 'week' || paramsPeriod === 'month'
            ? paramsPeriod
            : _isReceptionist
              ? 'day'
              : 'month'
        setPeriod(_period)

        if (_isDoctor) {
          const [statsResult, upcomingAppointmentsResult, recentMedicalRecordsResult] =
            await Promise.all([
              getDoctorDashboardStats(),
              getUpcomingAppointments(10),
              getRecentMedicalRecords(10),
            ])
          setDoctorData({
            stats: statsResult || {
              totalOrthoPatients: 0,
              signedConsentForms: 0,
              totalMedicalRecords: 0,
              todayCheckedIn: 0,
              todayBooked: 0,
            },
            upcomingAppointments: upcomingAppointmentsResult || [],
            recentMedicalRecords: recentMedicalRecordsResult || [],
          })
        } else if (_isReceptionist) {
          const [
            statsResult,
            upcomingAppointmentsResult,
            lowStockItemsResult,
            birthdaysAndFollowupsResult,
            overduePaymentsResult,
          ] = await Promise.all([
            getReceptionistDashboardStats(_period),
            getUpcomingAppointments(10),
            getLowStockItems(10),
            getBirthdaysAndFollowups(),
            getOverduePaymentPlans(),
          ])
          setReceptionistData({
            stats: statsResult || {
              totalPatients: 0,
              todayPayments: 0,
              todayExpenses: 0,
              todayCheckedIn: 0,
              todayBooked: 0,
            },
            upcomingAppointments: upcomingAppointmentsResult || [],
            lowStockItems: lowStockItemsResult || [],
            birthdaysAndFollowups: birthdaysAndFollowupsResult || { birthdays: [], followups: [] },
            overduePayments: overduePaymentsResult || [],
          })
        } else {
          const [
            statsResult,
            upcomingAppointmentsResult,
            recentReportsResult,
            lowStockItemsResult,
            birthdaysAndFollowupsResult,
            overduePaymentsResult,
          ] = await Promise.all([
            getDashboardStats(_period),
            getUpcomingAppointments(10),
            getRecentReports(7),
            getLowStockItems(10),
            getBirthdaysAndFollowups(),
            getOverduePaymentPlans(),
          ])
          setAdminData({
            stats: statsResult || {
              totalPatients: 0,
              totalRevenue: 0,
              totalExpenses: 0,
              checkedIn: 0,
              booked: 0,
            },
            upcomingAppointments: upcomingAppointmentsResult || [],
            recentReports: recentReportsResult || [],
            lowStockItems: lowStockItemsResult || [],
            birthdaysAndFollowups: birthdaysAndFollowupsResult || { birthdays: [], followups: [] },
            overduePayments: overduePaymentsResult || [],
          })
        }
      } catch (e: any) {
        console.error(e)
        setError(e.message || 'Error loading dashboard')
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [searchParams])

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2
          className="h-8 w-8 animate-spin text-muted-foreground"
          role="status"
          aria-label="Loading dashboard"
        />
      </div>
    )
  }

  if (error) {
    return <div className="p-6 text-red-500">{error}</div>
  }

  if (isDoctor && doctorData) {
    return (
      <DoctorDashboardContent
        stats={doctorData.stats}
        upcomingAppointments={doctorData.upcomingAppointments}
        recentMedicalRecords={doctorData.recentMedicalRecords}
      />
    )
  }

  if (isReceptionist && receptionistData) {
    return (
      <ReceptionistDashboardContent
        stats={receptionistData.stats}
        upcomingAppointments={receptionistData.upcomingAppointments}
        lowStockItems={receptionistData.lowStockItems}
        birthdaysAndFollowups={receptionistData.birthdaysAndFollowups}
        overduePayments={receptionistData.overduePayments}
        period={period}
      />
    )
  }

  if (adminData) {
    return (
      <DashboardContent
        stats={adminData.stats}
        upcomingAppointments={adminData.upcomingAppointments}
        recentReports={adminData.recentReports}
        lowStockItems={adminData.lowStockItems}
        birthdaysAndFollowups={adminData.birthdaysAndFollowups}
        overduePayments={adminData.overduePayments}
        period={period}
      />
    )
  }

  return <div className="p-6">Unable to load dashboard</div>
}
