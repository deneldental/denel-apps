import { ScanLine } from 'lucide-react'
import { Navigate, Route } from 'react-router-dom'
import XrayDetailPage from '@/features/xrays/pages/detail'
import XraysHomePage from '@/features/xrays/pages/index'
import type { Module } from './types'

export const xraysModule: Module = {
  id: 'xrays',
  label: 'X-rays',
  order: 9.0,
  hasAccess: (can) => can('xrays', 'read') && !can('messaging', 'read'),
  routes: [
    <Route key="xrays" path="/xrays" element={<XraysHomePage />} />,
    <Route key="xrays-detail" path="/xrays/:id" element={<XrayDetailPage />} />,
    <Route key="xrays-scans" path="/xrays/scans" element={<Navigate to="/xrays" replace />} />,
    <Route key="xrays-share" path="/xrays/share" element={<Navigate to="/xrays" replace />} />,
    <Route key="xrays-reports" path="/xrays/reports" element={<Navigate to="/xrays" replace />} />,
  ],
  navItems: [
    {
      label: 'X-rays',
      to: '/xrays',
      icon: ScanLine,
    },
  ],
}
