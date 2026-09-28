import { ShieldCheck } from 'lucide-react'
import { Route } from 'react-router-dom'
import { AccessLayout } from '@/features/access-management/access-layout'
import AllAccessPage from '@/features/access-management/pages/index'
import KioskAdminPage from '@/features/access-management/pages/kiosk'
import MatrixPage from '@/features/access-management/pages/matrix'
import PatientPwaPage from '@/features/access-management/pages/patients'
import PwaMatrixPage from '@/features/access-management/pages/pwa-matrix'
import BundlesPage from '@/features/users/pages/bundles'
import RolesPage from '@/features/users/pages/roles'
import type { Module } from './types'

export const accessManagementModule: Module = {
  id: 'access-management',
  label: 'Access Management',
  order: 12.8,
  permission: 'users',
  routes: [
    <Route key="access-layout" element={<AccessLayout />}>
      <Route path="/access-management" element={<AllAccessPage />} />
      <Route path="/access-management/patients" element={<PatientPwaPage />} />
      <Route path="/access-management/kiosk" element={<KioskAdminPage />} />
      <Route path="/roles" element={<RolesPage />} />
      <Route path="/bundles" element={<BundlesPage />} />
      <Route path="/matrix" element={<MatrixPage />} />
      <Route path="/pwa-matrix" element={<PwaMatrixPage />} />
    </Route>,
  ],
  navItems: [
    {
      label: 'Access Management',
      to: '/access-management',
      icon: ShieldCheck,
    },
  ],
}
