import { Settings } from 'lucide-react'
import { Route } from 'react-router-dom'
import SettingsDetailPage from '@/features/settings/pages/detail'
import SettingsHubPage from '@/features/settings/pages/index'
import type { Module } from './types'

export const settingsModule: Module = {
  id: 'settings',
  label: 'Settings',
  order: 17,
  permission: 'settings',
  routes: [
    <Route key="settings-hub" path="/settings" element={<SettingsHubPage />} />,
    <Route key="settings-detail" path="/settings/:groupId" element={<SettingsDetailPage />} />,
  ],
  navItems: [
    {
      label: 'Settings',
      to: '/settings',
      icon: Settings,
    },
  ],
}
