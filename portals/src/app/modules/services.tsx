import { LayoutList } from 'lucide-react'
import { Route } from 'react-router-dom'
import ServicesPage from '@/features/services/pages/index'
import type { Module } from './types'

export const servicesModule: Module = {
  id: 'services',
  label: 'Services',
  order: 5.0,
  permission: 'services',
  routes: [<Route key="services" path="/services" element={<ServicesPage />} />],
  navItems: [
    {
      label: 'Services',
      to: '/services',
      icon: LayoutList,
    },
  ],
}
