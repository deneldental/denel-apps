import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { DashboardContent } from '@/features/dashboard/components/dashboard-content'
import { DoctorDashboardContent } from '@/features/dashboard/components/doctor-dashboard-content'
import { ReceptionistDashboardContent } from '@/features/dashboard/components/receptionist-dashboard-content'
import { fetchActionItems } from '@/features/dashboard/hooks/use-action-items'
import type {
  ActionItemsData,
  AdminStats,
  AlertsPayload,
  AppointmentRow,
  DashboardPeriod,
  DoctorStats,
  LowStockItem,
  OverduePaymentPlan,
  RecentMedicalRecord,
  RecentReport,
  ReceptionistStats,
} from '@/features/dashboard/types'
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
import { useLoading } from '@/lib/loading-context'
import { usePermissions } from '@/shared/hooks/use-permissions'

const EMPTY_ADMIN_STATS: AdminStats = {
  totalPatients: 0,
  totalRevenue: 0,
  totalExpenses: 0,
  checkedIn: 0,
  booked: 0,
}
const EMPTY_DOCTOR_STATS: DoctorStats = {
  newPatients: 0,
  signedConsentForms: 0,
  pendingMedicalRecords: 0,
  todayCheckedIn: 0,
  todayBooked: 0,
}
const EMPTY_RECEPTIONIST_STATS: ReceptionistStats = {
  totalPatients: 0,
  todayPayments: 0,
  todayExpenses: 0,
  todayCheckedIn: 0,
  todayBooked: 0,
}
const EMPTY_ALERTS: AlertsPayload = { birthdays: [], followups: [] }
const EMPTY_ACTION_ITEMS: ActionItemsData = {
  recalls: [],
  reminders: [],
  unconfirmedAppts: [],
}

export default function DashboardPage() {
  const {
    hasPermission,
    isLoading: permissionsLoading,
    isAdmin,
    roleId,
    roleName,
  } = usePermissions()
  const isDoctor =
    !isAdmin && hasPermission('medical_records', 'read') && !hasPermission('appointments', 'create')
  const isReceptionist =
    !isAdmin && hasPermission('appointments', 'create') && !hasPermission('medical_records', 'read')

  const { setIsLoading } = useLoading()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const periodParam = searchParams.get('period')
  const period: DashboardPeriod =
    periodParam === 'day' || periodParam === 'week' || periodParam === 'month'
      ? periodParam
      : 'month'

  const [doctorStats, setDoctorStats] = useState<DoctorStats>(EMPTY_DOCTOR_STATS)
  const [upcomingAppointments, setUpcomingAppointments] = useState<AppointmentRow[]>([])
  const [recentMedicalRecords, setRecentMedicalRecords] = useState<RecentMedicalRecord[]>([])

  const [receptionistStats, setReceptionistStats] =
    useState<ReceptionistStats>(EMPTY_RECEPTIONIST_STATS)
  const [adminStats, setAdminStats] = useState<AdminStats>(EMPTY_ADMIN_STATS)
  const [recentReports, setRecentReports] = useState<RecentReport[]>([])
  const [lowStockItems, setLowStockItems] = useState<LowStockItem[]>([])
  const [birthdaysAndFollowups, setBirthdaysAndFollowups] = useState<AlertsPayload>(EMPTY_ALERTS)
  const [overduePayments, setOverduePayments] = useState<OverduePaymentPlan[]>([])
  const [actionItems, setActionItems] = useState<ActionItemsData>(EMPTY_ACTION_ITEMS)

  // Silent refetch after mutations — does NOT toggle the global loading
  // overlay (only the initial useEffect does).
  const reloadActionItems = useCallback(async () => {
    if (!isAdmin && !isReceptionist) return
    const next = await fetchActionItems(isAdmin)
    setActionItems(next)
  }, [isAdmin, isReceptionist])

  const load = useCallback(async () => {
    if (permissionsLoading) return

    try {
      if (isDoctor) {
        const [statsResult, appointmentsResult, medicalRecordsResult] = await Promise.all([
          getDoctorDashboardStats(),
          getUpcomingAppointments(10),
          getRecentMedicalRecords(10),
        ])
        setDoctorStats((statsResult as DoctorStats) ?? EMPTY_DOCTOR_STATS)
        setUpcomingAppointments((appointmentsResult as AppointmentRow[]) ?? [])
        setRecentMedicalRecords((medicalRecordsResult as RecentMedicalRecord[]) ?? [])
        return
      }

      if (isReceptionist) {
        const [
          statsResult,
          appointmentsResult,
          lowStockResult,
          birthdaysResult,
          overdueResult,
          actionItemsResult,
          recentReportsResult,
        ] = await Promise.all([
          // Reception stat cards are always "today" — the period switcher was
          // removed so the card labels ("Today's Payments", …) can't disagree
          // with the numbers underneath them.
          getReceptionistDashboardStats('day'),
          getUpcomingAppointments(10),
          getLowStockItems(10),
          getBirthdaysAndFollowups(),
          getOverduePaymentPlans(),
          fetchActionItems(false),
          getRecentReports(7),
        ])
        setReceptionistStats((statsResult as ReceptionistStats) ?? EMPTY_RECEPTIONIST_STATS)
        setUpcomingAppointments((appointmentsResult as AppointmentRow[]) ?? [])
        setLowStockItems((lowStockResult as LowStockItem[]) ?? [])
        setBirthdaysAndFollowups((birthdaysResult as AlertsPayload) ?? EMPTY_ALERTS)
        setOverduePayments((overdueResult as OverduePaymentPlan[]) ?? [])
        setActionItems(actionItemsResult ?? EMPTY_ACTION_ITEMS)
        setRecentReports((recentReportsResult as RecentReport[]) ?? [])
        return
      }

      const statsFunction = () => getDashboardStats(period)
      const upcomingPromise = Promise.resolve([] as AppointmentRow[])

      const [
        statsResult,
        appointmentsResult,
        recentReportsResult,
        lowStockResult,
        birthdaysResult,
        overdueResult,
        actionItemsResult,
      ] = await Promise.all([
        statsFunction(),
        upcomingPromise,
        getRecentReports(7),
        getLowStockItems(10),
        getBirthdaysAndFollowups(),
        getOverduePaymentPlans(),
        isAdmin || isReceptionist ? fetchActionItems(isAdmin) : Promise.resolve(EMPTY_ACTION_ITEMS),
      ])

      setUpcomingAppointments((appointmentsResult as AppointmentRow[]) ?? [])
      setRecentReports((recentReportsResult as RecentReport[]) ?? [])
      setLowStockItems((lowStockResult as LowStockItem[]) ?? [])
      setBirthdaysAndFollowups((birthdaysResult as AlertsPayload) ?? EMPTY_ALERTS)
      setOverduePayments((overdueResult as OverduePaymentPlan[]) ?? [])
      setActionItems(actionItemsResult ?? EMPTY_ACTION_ITEMS)

      setAdminStats((statsResult as AdminStats) ?? EMPTY_ADMIN_STATS)
    } catch (err) {
      console.error('[Dashboard] Failed to load dashboard data:', err)
    } finally {
      setIsLoading(false)
    }
  }, [period, setIsLoading, isDoctor, isReceptionist, isAdmin, permissionsLoading])

  useEffect(() => {
    if (permissionsLoading) return
    setIsLoading(true)
    load()
  }, [load, setIsLoading, permissionsLoading])

  if (isDoctor) {
    return (
      <DoctorDashboardContent
        stats={doctorStats}
        upcomingAppointments={upcomingAppointments}
        recentMedicalRecords={recentMedicalRecords}
      />
    )
  }

  if (isReceptionist) {
    return (
      <ReceptionistDashboardContent
        stats={receptionistStats}
        upcomingAppointments={upcomingAppointments}
        lowStockItems={lowStockItems}
        birthdaysAndFollowups={birthdaysAndFollowups}
        overduePayments={overduePayments}
        recentReports={recentReports}
        actionItems={actionItems}
        onReloadActionItems={reloadActionItems}
        onReload={load}
      />
    )
  }

  return (
    <DashboardContent
      stats={adminStats}
      recentReports={recentReports}
      lowStockItems={lowStockItems}
      birthdaysAndFollowups={birthdaysAndFollowups}
      overduePayments={overduePayments}
      period={period}
      hidePeriodSwitcher={false}
      actionItems={actionItems}
      onReloadActionItems={reloadActionItems}
      onReload={load}
    />
  )
}
