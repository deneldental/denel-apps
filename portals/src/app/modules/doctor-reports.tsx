import { BarChart3 } from 'lucide-react'
import { Route } from 'react-router-dom'
import DoctorReportsPage from '@/features/doctor-reports/pages/index'
import type { Module } from './types'

/**
 * Doctor Reports — the doctor-facing counterpart to the (doctor-disallowed)
 * clinic Reports module. One page: a weekly compilation of the signed-in
 * doctor's own clinical activity. Lives on its own route so the two never
 * collide, and is gated to the doctor role.
 */
export const doctorReportsModule: Module = {
  id: 'doctor-reports',
  label: 'Doctor Reports',
  order: 10.0, // immediately after the clinic Reports slot
  permission: 'reports',
  disallowedRoles: ['admin'],
  hasAccess: (can) => can('reports', 'read') && !can('messaging', 'read'),
  routes: [<Route key="doctor-reports" path="/my-reports" element={<DoctorReportsPage />} />],
  navItems: [
    {
      label: 'Doctor Reports',
      to: '/my-reports',
      icon: BarChart3,
    },
  ],
}
