import { Users } from 'lucide-react'
import { Route } from 'react-router-dom'
import CaseDetailPage from '@/features/patient-cases/pages/case-detail-page'
import PatientDetailPage from '@/features/patients/pages/detail'
import PatientsPage from '@/features/patients/pages/index'
import type { Module } from './types'

export const patientsModule: Module = {
  id: 'patients',
  label: 'Patient Records',
  order: 2.0,
  permission: 'patients',
  routes: [
    <Route key="patients" path="/patients" element={<PatientsPage />} />,
    <Route key="patient-detail" path="/patients/:id" element={<PatientDetailPage />} />,
    <Route
      key="case-detail"
      path="/patients/:patientId/cases/:caseId"
      element={<CaseDetailPage />}
    />,
  ],
  // Method A (Tabs): sub-items are just `?tab=*` views of the same PatientsPage,
  // which already renders internal <Tabs> driven by `useSearchParams`. Flat
  // top-level entry — no mini-sidebar needed.
  navItems: [
    {
      label: 'Patient Records',
      to: '/patients',
      icon: Users,
    },
  ],
}
