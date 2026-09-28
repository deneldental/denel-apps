import { queryClient } from '@/app/providers'
import { getDoctors } from '@/lib/actions/doctors'
import { useApiQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query-keys'
import { useLookup } from '@/shared/hooks/use-lookup'

type Doctor = { id: string; user?: { name: string; email?: string | null } | null }

// 60s staleTime: long enough that repeated opens in a sitting are instant
// (one fetch shared across every <AddAppointmentSheet />/<AddWalkInSheet />),
// short enough that a newly-created doctor surfaces within a minute — or
// immediately, via `invalidateAppointmentPickerCache` below.
//
// Patients are NOT fetched here — <PatientPicker> searches the server as the
// user types instead (see patient-picker.tsx). Bulk-fetching every patient
// into memory was the cause of a real production bug: past ~2,000 patients,
// a hardcoded cap silently dropped an arbitrary, unstable subset of them
// from every picker in the app.

/**
 * Shared doctors + appointment-types for the appointment/walk-in pickers, on
 * the TanStack Query cache so every open sheet reuses one fetch.
 */
export function useAppointmentPickers(enabled: boolean) {
  const doctorsQuery = useApiQuery<Doctor[]>(queryKeys.doctors.list(), getDoctors, {
    enabled,
    staleTime: 60_000,
  })
  // Appointment types are the generic lookup — already shared with the
  // scheduling calendar and every other appointment-type picker.
  const { rows: appointmentTypes } = useLookup('appointment-types', { enabled })

  return {
    doctors: doctorsQuery.data ?? [],
    appointmentTypes,
    refresh: async () => {
      await doctorsQuery.refetch()
    },
  }
}

/**
 * Force every open picker to refetch — call after creating a patient/doctor
 * inline (e.g. from `<AddPatientSheet onCreated>`) so it appears without
 * waiting out the 60s staleTime.
 */
export function invalidateAppointmentPickerCache(): void {
  queryClient.invalidateQueries({ queryKey: queryKeys.patients.all })
  queryClient.invalidateQueries({ queryKey: queryKeys.doctors.all })
}
