import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { usePatientAuth } from '@/lib/patient-auth'
import { RouteSkeleton } from '@/shared/components/route-skeleton'

/**
 * Patient route guard. Unlike the old PWA `RequireRole` (which juggled staff +
 * patient auth in one app), the patient app has a single auth domain — so this
 * guard only consults `usePatientAuth`. While the session probe is in flight we
 * show a skeleton; an unauthenticated visitor is bounced to the login screen.
 */
export function RequirePatient({ children }: { children: ReactNode }) {
  const { patient, loading } = usePatientAuth()

  if (loading && !patient) return <RouteSkeleton />
  if (!patient) return <Navigate to="/login" replace />
  return <>{children}</>
}
