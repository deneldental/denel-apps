import { ScrollText } from 'lucide-react'
import { Route } from 'react-router-dom'
import AuditLogsPage from '@/features/audit-logs/pages/index'
import type { Module } from './types'

export const auditModule: Module = {
  id: 'audit',
  label: 'Audit',
  order: 14,
  permission: 'audit_logs',
  routes: [<Route key="audit-logs" path="/audit-logs" element={<AuditLogsPage />} />],
  navItems: [
    {
      label: 'Audit',
      to: '/audit-logs',
      icon: ScrollText,
    },
  ],
}
