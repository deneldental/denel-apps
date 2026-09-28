import { ClipboardList } from 'lucide-react'
import { Route } from 'react-router-dom'
import ActivityPage from '@/features/activity/pages/index'
import type { Module } from './types'

/**
 * Activity — the visit worklist (build plan P2). A lens over today's visits, not
 * a new entity. Both doctors and reception see it (permission: appointments); the
 * page branches to the doctor day-sheet lens or the reception billing lens by role.
 */
export const activityModule: Module = {
  id: 'activity',
  label: 'Activity',
  order: 4.0, // between Scheduling (3) and Clinical (4)
  permission: 'appointments',
  routes: [<Route key="activity" path="/activity" element={<ActivityPage />} />],
  navItems: [{ label: 'Activity', to: '/activity', icon: ClipboardList }],
}
