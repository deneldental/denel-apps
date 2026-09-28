import { CalendarDays } from 'lucide-react'
import { Route } from 'react-router-dom'
import AppointmentsPage from '@/features/appointments/pages/index'
import ScheduledRemindersPage from '@/features/appointments/pages/reminders'
import type { Module } from './types'

export const schedulingModule: Module = {
  id: 'scheduling',
  label: 'Scheduling',
  order: 3.0,
  permission: 'appointments',
  routes: [
    <Route key="appointments" path="/appointments" element={<AppointmentsPage />} />,
    // Scheduled Reminders lives under Scheduling now — it's a tool the
    // receptionist reaches for while looking at the calendar. The page
    // breadcrumbs back to /appointments.
    <Route
      key="appointments-reminders"
      path="/appointments/reminders"
      element={<ScheduledRemindersPage />}
    />,
  ],
  // Scheduling is a Method A (Tabs) module: all sub-items are `?tab=*` query
  // params on the same `/appointments` page. The page renders its own internal
  // <Tabs>, so no mini-sidebar is needed — just a flat top-level entry.
  navItems: [
    {
      label: 'Scheduling',
      to: '/appointments',
      icon: CalendarDays,
    },
  ],
}
