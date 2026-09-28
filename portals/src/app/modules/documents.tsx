import { FileSignature } from 'lucide-react'
import { Route } from 'react-router-dom'
import DocumentsPage from '@/features/documents/pages/index'
import type { Module } from './types'

export const documentsModule: Module = {
  id: 'documents',
  label: 'Signed Documents',
  order: 13.2,
  permission: 'compliance',
  // Signed Documents is a compliance/admin surface — doctors don't administer
  // signed-document records, so it's kept out of their sidebar.
  disallowedRoles: ['doctor'],
  routes: [<Route key="documents" path="/documents" element={<DocumentsPage />} />],
  navItems: [
    {
      label: 'Signed Documents',
      to: '/documents',
      icon: FileSignature,
    },
  ],
}
