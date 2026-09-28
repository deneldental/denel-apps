import { Heart } from 'lucide-react'
import { Navigate, Route } from 'react-router-dom'
import { CrmLayout } from '@/features/crm/crm-layout'
import CrmHealthPage from '@/features/crm/pages/health'
import HolidaysPage from '@/features/crm/pages/holidays'
import RecarePage from '@/features/crm/pages/recare'
import SmsTemplatesPage from '@/features/crm/pages/sms-templates'
import CrmSyncPage from '@/features/crm/pages/sync'
import MessagingPage from '@/features/messaging/pages/index'
import { CrmAutomationsSection } from '@/features/settings/components/crm-automations-section'
import { AdminRoute } from '@/shared/components/admin-route'
import type { Module } from './types'

export const crmModule: Module = {
  id: 'crm',
  label: 'CRM',
  order: 4.5,
  hasAccess: (can) => can('messaging', 'read'),
  routes: [
    <Route key="crm-admin" element={<AdminRoute />}>
      <Route element={<CrmLayout />}>
        <Route path="/crm/messaging" element={<MessagingPage />} />
        <Route path="/crm/health" element={<CrmHealthPage />} />
        <Route path="/crm/sync" element={<CrmSyncPage />} />
        <Route path="/crm/sms-templates" element={<SmsTemplatesPage />} />
        <Route path="/crm/recare" element={<RecarePage />} />
        <Route path="/crm/holidays" element={<HolidaysPage />} />
        <Route
          path="/crm/settings"
          element={
            <div className="p-6 max-w-4xl">
              <CrmAutomationsSection />
            </div>
          }
        />
        {/* Legacy redirects */}
        <Route path="/messaging" element={<Navigate to="/crm/messaging" replace />} />
        <Route
          path="/crm/reminder-templates"
          element={<Navigate to="/crm/sms-templates" replace />}
        />
      </Route>
    </Route>,
  ],
  navItems: [
    {
      label: 'Messaging',
      to: '/crm/messaging',
      icon: Heart,
    },
  ],
}
