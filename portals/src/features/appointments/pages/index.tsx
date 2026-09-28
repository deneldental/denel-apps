import { addMonths, startOfMonth, subMonths } from 'date-fns'
import { AlertTriangle } from 'lucide-react'
import { useEffect, useMemo } from 'react'
import { AppointmentsShell } from '@/features/appointments/components/appointments-shell'
import { getAppointments } from '@/lib/actions/appointments'
import { getDoctorUnavailability } from '@/lib/actions/doctor-availability'
import { api } from '@/lib/api-client'
import { useLoading } from '@/lib/loading-context'
import { useApiQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query-keys'
import { usePermissions } from '@/shared/hooks/use-permissions'

const VALID_STATUSES = new Set([
  'scheduled',
  'confirmed',
  'checked_in',
  'in_chair',
  'completed',
  'rescheduled',
])

export default function AppointmentsPage() {
  const { setIsLoading } = useLoading()

  // Bound the fetch to a 4-month window around today (prev month + current
  // + next 2). Avoids pulling the entire historical table; users can
  // navigate within this window without a re-fetch.
  const fetchWindow = useMemo(() => {
    const now = new Date()
    return {
      from: subMonths(startOfMonth(now), 1),
      to: addMonths(startOfMonth(now), 3),
    }
  }, [])

  const {
    hasPermission,
    isLoading: permissionsLoading,
    isAdmin,
    roleId,
    roleName,
  } = usePermissions()
  const isDoctor =
    roleId === 'doctor' ||
    roleName?.toLowerCase() === 'doctor' ||
    roleName?.toLowerCase().includes('doctor')
  const isClinicalUser =
    hasPermission('medical_records', 'read') && !hasPermission('appointments', 'create')
  const scoped = isDoctor || isClinicalUser

  // /api/doctors/me, not a scan of /api/doctors: that list is built from
  // `specialists`, so a doctors row linked directly to a user (userId set,
  // specialistId null) is absent from it and the scan never matched —
  // which left every such doctor flagged "unlinked" and un-auto-filled.
  const meQuery = useApiQuery(
    queryKeys.doctors.me(),
    () => api.get<{ id: string; name: string | null } | null>('/api/doctors/me'),
    { enabled: scoped && !permissionsLoading, staleTime: 5 * 60_000 }
  )
  const doctorId = scoped ? meQuery.data?.id : undefined
  const doctorName = scoped ? (meQuery.data?.name ?? undefined) : undefined
  // No doctors row is linked to this account (or the lookup failed) — the
  // calendar would otherwise render silently empty and Block Time couldn't
  // scope to them, so say so instead.
  const unlinked = scoped && (meQuery.isError || (meQuery.isSuccess && !meQuery.data))

  // Ready to fetch once permissions are known and, for scoped roles, the
  // doctor record has resolved to an id.
  const dataEnabled = !permissionsLoading && (!scoped || !!doctorId)
  const listFilters = { ...fetchWindow, doctorId: scoped ? doctorId : undefined }

  const appointmentsQuery = useApiQuery(
    queryKeys.appointments.list(listFilters),
    () =>
      getAppointments({
        ...fetchWindow,
        ...(scoped && doctorId ? { doctorId } : {}),
      }),
    {
      enabled: dataEnabled,
      // Scoped roles (doctor / clinical-user-without-create) only ever see
      // their own booked visits — terminal statuses like cancelled/no_show
      // stay off their calendar even on reload.
      select: (rows) =>
        scoped ? rows.filter((a) => VALID_STATUSES.has(a.status ?? 'scheduled')) : rows,
    }
  )
  const unavailabilityQuery = useApiQuery(
    queryKeys.appointments.unavailability(scoped ? doctorId : undefined),
    () => getDoctorUnavailability(scoped ? doctorId : undefined),
    { enabled: dataEnabled }
  )

  const resolvingDoctor = scoped && meQuery.isLoading
  const showLoading =
    permissionsLoading ||
    resolvingDoctor ||
    (dataEnabled && (appointmentsQuery.isLoading || unavailabilityQuery.isLoading))

  // Mirror the combined loading state into the shared reference-counted
  // loading context so anything else observing it (e.g. a top progress bar)
  // still reacts, without round-tripping the render gate through it.
  useEffect(() => {
    setIsLoading(showLoading)
  }, [showLoading, setIsLoading])

  if (showLoading) return null

  return (
    <div id="appt-page-wrapper" className="p-6 pb-12 h-[calc(100vh-60px)] overflow-hidden">
      {unlinked && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50/50 p-3 text-sm dark:bg-amber-950/20">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <p>
            Your account isn't linked to a doctor profile, so this calendar is empty and blocking
            your own time isn't possible. Ask an administrator to connect your user account to your
            doctor profile.
          </p>
        </div>
      )}
      <AppointmentsShell
        appointments={appointmentsQuery.data ?? []}
        unavailability={unavailabilityQuery.data ?? []}
        isClinicalUser={isClinicalUser}
        isAdmin={isAdmin}
        isDoctor={isDoctor}
        currentDoctorId={doctorId}
        currentDoctorName={doctorName}
        onReload={() => {
          appointmentsQuery.refetch()
          unavailabilityQuery.refetch()
        }}
      />
    </div>
  )
}
