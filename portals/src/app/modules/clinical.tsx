import { Stethoscope } from 'lucide-react'
import { Navigate, Route } from 'react-router-dom'
import { ClinicalLayout } from '@/features/clinical/clinical-layout'
import { ClinicalPage } from '@/features/clinical/pages/clinical-page'
import MedicalRecordDetailPage from '@/features/medical-records/pages/detail'
import PatientMedicalRecordsPage from '@/features/medical-records/pages/patient-medical-records'
import type { Module } from './types'

export const clinicalModule: Module = {
  id: 'clinical',
  label: 'Clinical',
  order: 5.0,
  // Doctor and receptionist both carry bundle_clinical_full, so we can't gate
  // on a module slug alone. Use hasAccess to restrict to clinical staff.
  hasAccess: (can) => can('medical_records', 'read') && !can('messaging', 'read'),
  routes: [
    <Route key="clinical-layout" element={<ClinicalLayout />}>
      {/* Tabbed clinical page — `:tab` is one of cases | treatments | Prescriptions */}
      <Route path="/clinical" element={<Navigate to="/clinical/cases" replace />} />
      <Route path="/clinical/:tab" element={<ClinicalPage />} />

      {/* Legacy medical records routes — kept for backward compat */}
      <Route path="/medical-records" element={<Navigate to="/clinical/cases" replace />} />
      <Route path="/medical-records/patient/:patientId" element={<PatientMedicalRecordsPage />} />
      <Route path="/medical-records/:id" element={<MedicalRecordDetailPage />} />
    </Route>,
  ],
  navItems: [
    {
      label: 'Medical Records',
      to: '/clinical/treatments',
      icon: Stethoscope,
    },
  ],
}
