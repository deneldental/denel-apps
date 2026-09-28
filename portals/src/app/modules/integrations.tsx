import { Route } from 'react-router-dom'
import DataSyncPage from '@/features/data-sync/pages/index'
import DataSyncRulesPage from '@/features/data-sync/pages/rules'
import BackupConfigPage from '@/features/integrations/pages/backup'
import CloudinaryConfigPage from '@/features/integrations/pages/cloudinary'
import CronEngineConfigPage from '@/features/integrations/pages/cron-engine'
import DoSpacesConfigPage from '@/features/integrations/pages/do-spaces'
import GoogleCalendarConfigPage from '@/features/integrations/pages/google-calendar'
import HubtelConfigPage from '@/features/integrations/pages/hubtel'
import IntegrationsHubPage from '@/features/integrations/pages/index'
import R2ConfigPage from '@/features/integrations/pages/r2'
import StorageRoutingConfigPage from '@/features/integrations/pages/storage-routing'
import UpstashConfigPage from '@/features/integrations/pages/upstash'
import WebsiteBookingsConfigPage from '@/features/integrations/pages/website-bookings'
import type { Module } from './types'

export const integrationsModule: Module = {
  id: 'integrations',
  label: 'Integrations',
  order: 16,
  permission: 'integrations',
  routes: [
    <Route key="integrations" path="/integrations" element={<IntegrationsHubPage />} />,
    <Route key="integrations-r2" path="/integrations/r2" element={<R2ConfigPage />} />,
    <Route
      key="integrations-do-spaces"
      path="/integrations/do-spaces"
      element={<DoSpacesConfigPage />}
    />,
    <Route
      key="integrations-cloudinary"
      path="/integrations/cloudinary"
      element={<CloudinaryConfigPage />}
    />,
    <Route key="integrations-hubtel" path="/integrations/hubtel" element={<HubtelConfigPage />} />,
    <Route
      key="integrations-google-calendar"
      path="/integrations/google-calendar"
      element={<GoogleCalendarConfigPage />}
    />,
    <Route key="integrations-backup" path="/integrations/backup" element={<BackupConfigPage />} />,
    <Route
      key="integrations-upstash"
      path="/integrations/upstash"
      element={<UpstashConfigPage />}
    />,
    <Route
      key="integrations-cron-engine"
      path="/integrations/cron-engine"
      element={<CronEngineConfigPage />}
    />,
    <Route
      key="integrations-storage-routing"
      path="/integrations/storage-routing"
      element={<StorageRoutingConfigPage />}
    />,
    <Route
      key="integrations-website-bookings"
      path="/integrations/website-bookings"
      element={<WebsiteBookingsConfigPage />}
    />,
    <Route key="data-sync" path="/data-sync" element={<DataSyncPage />} />,
    <Route key="data-sync-rules" path="/data-sync/rules" element={<DataSyncRulesPage />} />,
  ],
  // No sidebar entry — Integrations is reached via Settings → Integrations & APIs
  // (the `integrations-hub` section renders the same IntegrationsHubPage).
  navItems: [],
}
