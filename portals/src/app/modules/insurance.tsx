import { ShieldCheck } from 'lucide-react'
import { Route } from 'react-router-dom'
import InsurancePage from '@/features/insurance/pages/index'
import type { Module } from './types'

export const insuranceModule: Module = {
  id: 'insurance',
  label: 'Insurance',
  order: 11.0,
  // Empty list = admin-only: admins bypass this check, every other role (doctors
  // included) no longer sees Insurance in the sidebar. The route stays registered.
  allowedRoles: ['receptionist'],
  routes: [<Route key="insurance" path="/insurance" element={<InsurancePage />} />],
  navItems: [
    {
      label: 'Insurance',
      to: '/insurance',
      icon: ShieldCheck,
    },
  ],
}
