import { Home } from 'lucide-react'
import { Route } from 'react-router-dom'
import DashboardPage from '@/features/dashboard/pages/index'
import type { Module } from './types'

export const overviewModule: Module = {
  id: 'overview',
  label: 'Overview',
  order: 1.0,
  routes: [<Route key="dashboard" path="/dashboard" element={<DashboardPage />} />],
  navItems: [
    {
      label: 'Overview',
      to: '/dashboard',
      icon: Home,
    },
  ],
}
